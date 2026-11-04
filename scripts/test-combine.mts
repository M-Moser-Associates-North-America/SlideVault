/**
 * One combined .pptx from several decks (docs/DECISIONS.md FD-21), run against the synthetic fixtures.
 *
 *   npm run test:combine
 *
 * Checks the package itself: selected order across decks, each slide keeping its own deck's
 * design, unique ids, no broken references, no leftovers from unselected slides, the mixed-size
 * fallback to a .zip, and (when LibreOffice is installed) that the file actually opens.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { combineDecks, MixedSlideSizesError } from '../features/slide-vault/server/combine-pptx';
import { exportSelectedSlides, listSlides } from '../features/slide-vault/server/export-pptx';
import type { LibraryIndex } from '../features/slide-vault/server/library-repository';
import { exportSlides } from '../features/slide-vault/server/services/export';

const FIXTURES = path.resolve(import.meta.dirname, '../tests/fixtures');
const KESTREL = 'sharepoint-library/Best of the Best/SME/Kestrel Law - SME.pptx';
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const load = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const textOf = (xml: string) => (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join(' ');

async function slideXmls(pkg: Uint8Array) {
  const zip = await JSZip.loadAsync(pkg);
  return Promise.all((await listSlides(pkg)).map(async (s) => ({ ...s, xml: await zip.file(s.part)!.async('string') })));
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const resolve = (owner: string, target: string) => {
  const parts: string[] = [];
  for (const seg of (target.startsWith('/') ? target.slice(1) : dirOf(owner) + target).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};
async function relsOf(zip: JSZip, owner: string) {
  const name = owner === '' ? '_rels/.rels' : `${dirOf(owner)}_rels/${owner.slice(dirOf(owner).length)}.rels`;
  const f = zip.file(name);
  if (!f) return [];
  return [...(await f.async('string')).matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({
    type: m[0].match(/Type="([^"]+)"/)![1].split('/').pop()!,
    target: m[0].match(/Target="([^"]+)"/)![1],
    external: /TargetMode="External"/.test(m[0]),
  }));
}

/** Broken references, parts with no content type, and duplicate or out-of-range ids. */
async function packageProblems(pkg: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(pkg);
  const problems: string[] = [];
  for (const relsName of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
    const owner = relsName === '_rels/.rels' ? '' : relsName.replace(/_rels\/([^/]+)\.rels$/, '$1');
    for (const r of await relsOf(zip, owner)) if (!r.external && !zip.file(resolve(owner, r.target))) problems.push(`broken: ${owner} -> ${r.target}`);
  }
  const ct = await zip.file('[Content_Types].xml')!.async('string');
  const overrides = new Set([...ct.matchAll(/PartName="\/([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  const defaults = new Set([...ct.matchAll(/<Default\b[^>]*Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || name === '[Content_Types].xml') continue;
    if (!overrides.has(name.toLowerCase()) && !defaults.has(name.split('.').pop()!.toLowerCase())) problems.push(`no content type: ${name}`);
  }
  for (const o of overrides) if (!zip.file(new RegExp(`^${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')).length) problems.push(`content type for missing part: ${o}`);
  const pres = await zip.file('ppt/presentation.xml')!.async('string');
  const slideIds = [...pres.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
  if (new Set(slideIds).size !== slideIds.length || slideIds.some((n) => n < 256 || n >= 2147483648)) problems.push(`bad slide ids: ${slideIds}`);
  const big = [...pres.matchAll(/<p:sldMasterId\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slideMasters\/[^/]+\.xml$/.test(n)))
    big.push(...[...(await zip.file(name)!.async('string')).matchAll(/<p:sldLayoutId\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])));
  if (new Set(big).size !== big.length || big.some((n) => n < 2147483648)) problems.push(`bad master/layout ids: ${big}`);
  return problems;
}

/** For each slide in order: the master it uses, which must be one presentation.xml lists. */
async function mastersBySlide(pkg: Uint8Array): Promise<{ master: string; listed: boolean }[]> {
  const zip = await JSZip.loadAsync(pkg);
  const presRels = await relsOf(zip, 'ppt/presentation.xml');
  const listed = new Set(presRels.filter((r) => r.type === 'slideMaster').map((r) => resolve('ppt/presentation.xml', r.target)));
  const out = [];
  for (const s of await listSlides(pkg)) {
    const layout = resolve(s.part, (await relsOf(zip, s.part)).find((r) => r.type === 'slideLayout')!.target);
    const master = resolve(layout, (await relsOf(zip, layout)).find((r) => r.type === 'slideMaster')!.target);
    out.push({ master, listed: listed.has(master) });
  }
  return out;
}

const before = Object.fromEntries(readdirSync(FIXTURES).filter((f) => f.endsWith('.pptx')).map((f) => [f, sha(load(f))]));

// --- 1. two decks, interleaved, with a native chart -----------------------------------------------------
const nwSrc = await slideXmls(load('northwind-capabilities.pptx'));
const hbSrc = await slideXmls(load('harbor-bank-proposal.pptx'));
const nwTrim = await exportSelectedSlides(load('northwind-capabilities.pptx'), [4, 1]);
const hbTrim = await exportSelectedSlides(load('harbor-bank-proposal.pptx'), [3, 2]);
// northwind 4, harbor 3, northwind 1, harbor 2
const combined = await combineDecks([{ bytes: nwTrim }, { bytes: hbTrim }], [{ deck: 0, slide: 1 }, { deck: 1, slide: 1 }, { deck: 0, slide: 2 }, { deck: 1, slide: 2 }]);
{
  const got = await slideXmls(combined);
  const want = [nwSrc[3], hbSrc[2], nwSrc[0], hbSrc[1]];
  check(got.length === 4, 'one file with all 4 selected slides');
  check(got.every((s, i) => textOf(s.xml) === textOf(want[i].xml)), 'slides follow the selected order across decks (NW4 → HB3 → NW1 → HB2)');
  const problems = await packageProblems(combined);
  check(problems.length === 0, 'no broken references, every part has a content type, all ids unique', problems.slice(0, 5).join('; '));
  const masters = await mastersBySlide(combined);
  check(masters.every((m) => m.listed), "every slide's master is registered in the presentation");
  check(masters[0].master !== masters[1].master && masters[0].master === masters[2].master && masters[1].master === masters[3].master,
    "each slide keeps its own deck's master (design), not the other deck's", masters.map((m) => m.master).join(', '));
  const zip = await JSZip.loadAsync(combined);
  const names = Object.keys(zip.files);
  check(got[1].xml.includes('<c:chart ') && names.some((n) => n.startsWith('ppt/embeddings/')), 'the chart and its data workbook come along, still editable');
  check(names.filter((n) => /^ppt\/slides\/[^/]+\.xml$/.test(n)).length === 4, 'the package physically holds only the 4 selected slides');
  check(!names.some((n) => n.startsWith('ppt/notesSlides/')) && !names.some((n) => /comment/i.test(n)), 'no speaker notes or comments');
  const all = (await Promise.all(names.filter((n) => n.endsWith('.xml')).map((n) => zip.file(n)!.async('string')))).join('\n');
  check(!all.includes('pricing guidance') && !all.includes('never export'), "nothing from slides that weren't picked");
  check((await zip.file('docProps/app.xml')!.async('string')).includes('<Slides>4</Slides>'), 'properties say 4 slides');
}

// --- 2. three decks, and a deck whose only slide comes last ---------------------------------------------
{
  const kTrim = await exportSelectedSlides(load(KESTREL), [1]);
  const three = await combineDecks([{ bytes: hbTrim }, { bytes: kTrim }, { bytes: nwTrim }], [{ deck: 2, slide: 2 }, { deck: 0, slide: 1 }, { deck: 2, slide: 1 }, { deck: 0, slide: 2 }, { deck: 1, slide: 1 }]);
  const got = await slideXmls(three);
  const kSrc = await slideXmls(load(KESTREL));
  check(got.length === 5 && textOf(got[0].xml) === textOf(nwSrc[0].xml) && textOf(got[4].xml) === textOf(kSrc[0].xml), 'three decks combine, in the selected order');
  const problems = await packageProblems(three);
  check(problems.length === 0, 'three-deck file is structurally clean', problems.slice(0, 5).join('; '));
  check((await mastersBySlide(three)).every((m) => m.listed), 'three-deck file: every master registered');
}

// --- 3. mixed slide sizes ---------------------------------------------------------------------------------
try {
  await combineDecks([{ bytes: nwTrim }, { bytes: await exportSelectedSlides(load('legacy-case-study-4x3.pptx'), [1]) }], [{ deck: 0, slide: 1 }, { deck: 0, slide: 2 }, { deck: 1, slide: 1 }]);
  check(false, '4:3 and 16:9 decks are refused, not squashed together');
} catch (e) {
  check(e instanceof MixedSlideSizesError, '4:3 and 16:9 decks are refused, not squashed together', (e as Error).message);
}
for (const [order, label] of [
  [[{ deck: 0, slide: 1 }], 'an order that leaves slides out'],
  [[{ deck: 0, slide: 1 }, { deck: 0, slide: 1 }, { deck: 1, slide: 1 }, { deck: 1, slide: 2 }], 'the same slide twice'],
  [[{ deck: 0, slide: 1 }, { deck: 0, slide: 2 }, { deck: 1, slide: 1 }, { deck: 5, slide: 1 }], 'a deck that does not exist'],
] as const) {
  try {
    await combineDecks([{ bytes: nwTrim }, { bytes: hbTrim }], [...order]);
    check(false, `rejects ${label}`);
  } catch {
    check(true, `rejects ${label}`);
  }
}

// --- 4. the export service ---------------------------------------------------------------------------------
{
  const indexFor = async (fileName: string) => {
    const bytes = load(fileName);
    return {
      id: `src_${fileName}`, title: fileName, fileName, versionId: `ver_${sha(bytes).slice(0, 16)}`, sha256: sha(bytes),
      slides: (await listSlides(bytes)).map((s) => ({ id: `${fileName}#${s.number}`, number: s.number, title: `Slide ${s.number}`, text: '', hidden: s.hidden })),
    };
  };
  const index: LibraryIndex = {
    generatedAt: new Date().toISOString(),
    sources: [await indexFor('northwind-capabilities.pptx'), await indexFor('harbor-bank-proposal.pptx'), await indexFor('legacy-case-study-4x3.pptx')],
  };
  const [nw, hb, legacy] = index.sources;
  const item = (s: (typeof index.sources)[number], n: number) => ({ slideId: `${s.fileName}#${n}`, sourceVersionId: s.versionId });
  const req = (items: ReturnType<typeof item>[], combine?: boolean) => ({ format: 'pptx' as const, fidelityPolicy: 'preserve-source' as const, items, combine });

  const one = await exportSlides(index, req([item(hb, 2), item(nw, 4), item(hb, 1)], true));
  const oneSlides = await slideXmls(one.bytes);
  check(one.fileName === 'SlideVault-export.pptx' && one.contentType.endsWith('presentationml.presentation') && one.deckCount === 2 && !one.note,
    'combine: true across two decks downloads one .pptx');
  check(oneSlides.length === 3 && textOf(oneSlides[0].xml) === textOf(hbSrc[1].xml) && textOf(oneSlides[1].xml) === textOf(nwSrc[3].xml) && textOf(oneSlides[2].xml) === textOf(hbSrc[0].xml),
    'the combined download keeps the cart order (HB2 → NW4 → HB1)');
  check((await packageProblems(one.bytes)).length === 0, 'the combined download is structurally clean');

  const zip = await exportSlides(index, req([item(hb, 2), item(nw, 4)]));
  check(zip.fileName === 'SlideVault-export.zip', 'without combine, two decks still come as a .zip (unchanged)');

  const mixed = await exportSlides(index, req([item(nw, 1), item(legacy, 1)], true));
  check(mixed.fileName === 'SlideVault-export.zip' && Boolean(mixed.note?.includes('slide sizes')), 'combine with 4:3 + 16:9 falls back to a .zip and says why', mixed.note ?? '');

  const single = await exportSlides(index, req([item(nw, 2)], true));
  check(single.fileName === 'SlideVault-export.pptx' && single.deckCount === 1, 'combine with one deck is just the normal single-deck file');

  // --- 5. does it really open? LibreOffice renders every slide, when it's installed ---------------------
  let soffice = '';
  for (const bin of ['soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      soffice = bin;
      break;
    } catch {
      /* not here */
    }
  }
  if (!soffice) console.log('SKIP  LibreOffice not installed: open-and-render check skipped');
  else {
    const dir = mkdtempSync(path.join(tmpdir(), 'sv-combine-'));
    try {
      writeFileSync(path.join(dir, 'combined.pptx'), one.bytes);
      execFileSync(soffice, ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'combined.pptx')], { stdio: 'ignore', timeout: 120_000 });
      const pdf = readFileSync(path.join(dir, 'combined.pdf'), 'latin1');
      const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      check(pages === 3, 'LibreOffice opens the combined file and renders all 3 slides', `${pages} pages`);
    } catch (e) {
      check(false, 'LibreOffice opens the combined file', (e as Error).message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

const after = Object.fromEntries(readdirSync(FIXTURES).filter((f) => f.endsWith('.pptx')).map((f) => [f, sha(load(f))]));
check(JSON.stringify(after) === JSON.stringify(before), 'source decks are byte-for-byte unchanged');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll combine checks passed');
process.exit(failures ? 1 : 0);
