/**
 * Export acceptance checks (client acceptance PR-07), run against the synthetic fixtures.
 *
 *   npm run test:export
 *
 * Inspects the generated packages themselves:
 *  - only the selected slides, in the selected order; nothing else physically remains
 *  - text, tables and charts stay native and editable (never pictures of slides)
 *  - speaker notes, comments, source thumbnail and source-identifying properties are removed
 *  - slide size is preserved (4:3 stays 4:3); hidden source slides become visible when selected
 *  - no broken internal references (PowerPoint would offer to "repair" the file)
 *  - slides from several decks come back as a .zip with one valid .pptx per deck (FD-09)
 *  - invalid, stale and unknown requests are rejected with clear messages
 *  - source files are byte-for-byte unchanged
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { exportSelectedSlides, ExportValidationError, listSlides } from '../features/slide-vault/server/export-pptx';
import { readConfig } from '../features/slide-vault/server/config';
import type { LibraryIndex } from '../features/slide-vault/server/library-repository';
import { ServiceError } from '../features/slide-vault/server/http';
import { exportSlides } from '../features/slide-vault/server/services/export';

const FIXTURES = path.resolve(import.meta.dirname, '../tests/fixtures');
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const load = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

async function slideXmls(pkg: Uint8Array) {
  const zip = await JSZip.loadAsync(pkg);
  return Promise.all((await listSlides(pkg)).map(async (s) => ({ ...s, xml: await zip.file(s.part)!.async('string') })));
}
const textOf = (xml: string) => (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join(' ');

async function brokenReferences(zip: JSZip) {
  let broken = 0;
  for (const relsName of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
    const owner = relsName === '_rels/.rels' ? '' : relsName.replace(/_rels\/([^/]+)\.rels$/, '$1');
    const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
    for (const m of (await zip.file(relsName)!.async('string')).matchAll(/<Relationship\b[^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const target = m[0].match(/Target="([^"]+)"/)![1];
      const parts: string[] = [];
      for (const seg of (target.startsWith('/') ? target.slice(1) : base + target).split('/')) {
        if (seg === '..') parts.pop();
        else if (seg && seg !== '.') parts.push(seg);
      }
      if (!zip.file(parts.join('/'))) broken++;
    }
  }
  const ct = await zip.file('[Content_Types].xml')!.async('string');
  for (const m of ct.matchAll(/PartName="\/([^"]+)"/g)) if (!zip.file(m[1])) broken++;
  return broken;
}

const before = Object.fromEntries(readdirSync(FIXTURES).filter((f) => f.endsWith('.pptx')).map((f) => [f, sha(load(f))]));

// --- 1. text, picture, table, shapes: slides 4, 6, 1 of the capabilities deck -------------------------
{
  const source = load('northwind-capabilities.pptx');
  const src = await slideXmls(source);
  const pick = [4, 6, 1];
  const out = await exportSelectedSlides(source, pick);
  const zip = await JSZip.loadAsync(out);
  const got = await slideXmls(out);
  const names = Object.keys(zip.files);
  const allXml = (await Promise.all(names.filter((n) => n.endsWith('.xml')).map((n) => zip.file(n)!.async('string')))).join('\n');

  check(got.length === 3, 'lists exactly the 3 selected slides');
  check(got.every((s, i) => textOf(s.xml) === textOf(src[pick[i] - 1].xml)), 'slides appear in the selected order (4 → 6 → 1)');
  check(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length === 3, 'package physically contains only 3 slides');
  check(got.every((s) => /<a:t>/.test(s.xml)), 'every slide keeps native, editable text');
  check(got[0].xml.includes('<a:tbl>'), 'the table stays a native PowerPoint table');
  check(got[1].xml.includes('prstGeom prst="roundRect"'), 'shapes stay native shapes');
  check(!allXml.includes('pricing guidance') && !allXml.includes('never export'), 'the unselected hidden slide and its notes are not in the file');
  check(!names.some((n) => n.startsWith('ppt/notesSlides/')), 'speaker notes removed');
  check(!names.some((n) => /comment|authors\.xml/i.test(n)), 'comments and comment authors removed');
  check(!names.includes('docProps/thumbnail.jpeg'), 'source cover thumbnail removed');
  const core = await zip.file('docProps/core.xml')!.async('string');
  check(core.includes('<dc:creator>SlideVault</dc:creator>') && !core.includes('fixtures'), 'author and title replaced with neutral values');
  const app = await zip.file('docProps/app.xml')!.async('string');
  check(app.includes('<Slides>3</Slides>') && !app.includes('Slide Titles'), 'properties no longer list the source slide titles');
  check((await brokenReferences(zip)) === 0, 'no broken internal references');
}

// --- 2. native chart -----------------------------------------------------------------------------------
{
  const out = await exportSelectedSlides(load('harbor-bank-proposal.pptx'), [3]);
  const zip = await JSZip.loadAsync(out);
  const [slide] = await slideXmls(out);
  const chartParts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
  check(slide.xml.includes('<c:chart ') && chartParts.length === 1, 'the chart stays a native, editable chart');
  check(Object.keys(zip.files).some((n) => n.startsWith('ppt/embeddings/')), "the chart's data workbook is kept (data stays editable)");
  check((await brokenReferences(zip)) === 0, 'chart export has no broken references');
}

// --- 3. slide size and hidden slides ------------------------------------------------------------------
{
  const out = await exportSelectedSlides(load('legacy-case-study-4x3.pptx'), [2, 1]);
  const pres = await (await JSZip.loadAsync(out)).file('ppt/presentation.xml')!.async('string');
  check(pres.includes('cx="9144000" cy="6858000"'), '4:3 slides keep their 4:3 size (no stretching)');

  const hidden = await listSlides(await exportSelectedSlides(load('northwind-capabilities.pptx'), [5]));
  check(hidden.length === 1 && !hidden[0].hidden, 'a hidden source slide is visible when deliberately selected');
}

// --- 4. engine validation -----------------------------------------------------------------------------
for (const [bad, label] of [
  [[], 'empty selection'],
  [[0], 'slide 0'],
  [[99], 'slide 99'],
  [[1.5], 'a non-whole number'],
  [[1, 1], 'the same slide twice'],
] as const) {
  try {
    await exportSelectedSlides(load('northwind-capabilities.pptx'), [...bad]);
    check(false, `rejects ${label}`);
  } catch (e) {
    check(e instanceof ExportValidationError, `rejects ${label}`, (e as Error).message);
  }
}

// --- 5. service rules (IDs and versions) --------------------------------------------------------------
{
  check(readConfig({}).libraryDir === FIXTURES, 'default library is the synthetic fixtures');
  const indexFor = async (fileName: string) => {
    const bytes = load(fileName);
    const versionId = `ver_${sha(bytes).slice(0, 16)}`;
    return {
      id: `src_${fileName}`,
      title: fileName,
      fileName,
      versionId,
      sha256: sha(bytes),
      slides: (await listSlides(bytes)).map((s) => ({ id: `${fileName}#${s.number}`, number: s.number, title: `Slide ${s.number}`, text: '', hidden: s.hidden })),
    };
  };
  const index: LibraryIndex = {
    generatedAt: new Date().toISOString(),
    sources: [await indexFor('northwind-capabilities.pptx'), await indexFor('harbor-bank-proposal.pptx')],
  };
  const [nw, hb] = index.sources;
  const item = (s: (typeof index.sources)[number], n: number) => ({ slideId: `${s.fileName}#${n}`, sourceVersionId: s.versionId });
  const request = (items: ReturnType<typeof item>[]) => ({ format: 'pptx' as const, fidelityPolicy: 'preserve-source' as const, items });

  const ok = await exportSlides(index, request([item(nw, 3), item(nw, 2)]));
  check((await listSlides(ok.bytes)).length === 2, 'service exports a valid ID-based request');
  check(ok.fileName === 'SlideVault-export.pptx' && ok.contentType.endsWith('presentationml.presentation') && ok.deckCount === 1,
    'one deck downloads as SlideVault-export.pptx');

  // Slides from two decks, interleaved: one .pptx per deck in a .zip, each keeping its own selected order
  const mixed = await exportSlides(index, request([item(hb, 2), item(nw, 4), item(hb, 1), item(nw, 1)]));
  check(mixed.fileName === 'SlideVault-export.zip' && mixed.contentType === 'application/zip' && mixed.deckCount === 2,
    'slides from two decks download as SlideVault-export.zip');
  const bundle = await JSZip.loadAsync(mixed.bytes);
  const entries = Object.keys(bundle.files).sort();
  check(entries.length === 2 && entries[0].startsWith('1 - ') && entries[1].startsWith('2 - ') && entries.every((n) => n.endsWith('.pptx')),
    'the zip holds two .pptx files, numbered in the order their decks were first selected', entries.join(' | '));
  check(entries[0].includes('(slides 2, 1)') && entries[1].includes('(slides 4, 1)'), 'file names list each deck\'s slide numbers', entries.join(' | '));
  const hbOut = await bundle.file(entries[0])!.async('uint8array');
  const nwOut = await bundle.file(entries[1])!.async('uint8array');
  check((await listSlides(hbOut)).length === 2 && (await listSlides(nwOut)).length === 2, 'each file holds only its deck\'s selected slides');
  const [hbSrc, nwSrc] = [await slideXmls(load('harbor-bank-proposal.pptx')), await slideXmls(load('northwind-capabilities.pptx'))];
  const [hbGot, nwGot] = [await slideXmls(hbOut), await slideXmls(nwOut)];
  check(textOf(hbGot[0].xml) === textOf(hbSrc[1].xml) && textOf(nwGot[0].xml) === textOf(nwSrc[3].xml),
    'each file keeps the selected order of its own slides (2 → 1, 4 → 1)');
  check((await brokenReferences(await JSZip.loadAsync(hbOut))) === 0 && (await brokenReferences(await JSZip.loadAsync(nwOut))) === 0,
    'files inside the zip have no broken internal references');

  const expectError = async (label: string, items: ReturnType<typeof item>[], status: number) => {
    try {
      await exportSlides(index, request(items));
      check(false, label);
    } catch (e) {
      check(e instanceof ServiceError && e.status === status, label, (e as Error).message);
    }
  };
  await expectError('rejects the same slide twice across a mixed selection (400)', [item(nw, 1), item(hb, 1), item(nw, 1)], 400);
  await expectError('rejects an outdated version (400)', [{ slideId: `${nw.fileName}#1`, sourceVersionId: 'ver_outdated' }], 400);
  await expectError('rejects an unknown slide (400)', [{ slideId: 'sld_unknown', sourceVersionId: nw.versionId }], 400);
}

// --- 6. sources untouched -----------------------------------------------------------------------------
check(Object.entries(before).every(([f, h]) => sha(load(f)) === h), 'all source decks unchanged (SHA-256 identical)');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll export checks passed');
process.exit(failures ? 1 : 0);
