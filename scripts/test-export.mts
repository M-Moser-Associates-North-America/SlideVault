/**
 * Export acceptance checks (client acceptance PR-07), run against the real reference deck.
 *
 *   npm run test:export
 *
 * Verifies, by inspecting the generated package itself:
 *  - only the selected slides are present, in the selected order
 *  - text stays native, editable text (not pictures of slides)
 *  - unselected slides, comments, notes and the source thumbnail are physically gone
 *  - source-identifying document properties are replaced
 *  - a hidden source slide becomes visible when selected
 *  - invalid requests are rejected with a clear message
 *  - the source file is byte-for-byte unchanged
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { exportSelectedSlides, ExportValidationError, listSlides } from '../features/slide-vault/server/export-pptx';
import { SOURCE_DECK } from '../features/slide-vault/server/source-deck';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const source = new Uint8Array(readFileSync(SOURCE_DECK.path));
const sourceHash = sha(source);
const slides = await listSlides(source);

async function slideTexts(pkg: Uint8Array) {
  const zip = await JSZip.loadAsync(pkg);
  const ordered = await listSlides(pkg);
  return Promise.all(
    ordered.map(async (s) => {
      const xml = await zip.file(s.part)!.async('string');
      return {
        ...s,
        text: (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join(' '),
        textRuns: (xml.match(/<a:t>/g) ?? []).length,
        hasTable: xml.includes('<a:tbl>'),
      };
    }),
  );
}
const sourceTexts = await slideTexts(source);

// --- the 8-step test selection: slides 9, 14, 1 -------------------------------------------
const pick = [9, 14, 1];
const out = await exportSelectedSlides(source, pick);
const zip = await JSZip.loadAsync(out);
const got = await slideTexts(out);
const names = Object.keys(zip.files);

check(got.length === 3, 'exported deck lists exactly the 3 selected slides', `${got.length} listed`);
check(
  got.every((s, i) => s.text === sourceTexts[pick[i] - 1].text),
  'slides appear in the selected order (9 → 14 → 1)',
);
check(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length === 3, 'package physically contains only 3 slide parts');
check(got.every((s) => s.textRuns > 0), 'every exported slide keeps native text runs (editable, not flattened)');
check(got[0].hasTable, 'slide 9 keeps its native PowerPoint table');

const leaked = sourceTexts.filter((s) => !pick.includes(s.number) && s.text.length > 40 && !sourceTexts.filter((t) => pick.includes(t.number)).some((t) => t.text.includes(s.text)));
const allXml = (await Promise.all(names.filter((n) => n.endsWith('.xml')).map((n) => zip.file(n)!.async('string')))).join('\n');
check(
  leaked.every((s) => !allXml.includes(s.text.slice(0, 60))),
  'no text from unselected slides remains anywhere in the package',
);
check(!names.some((n) => n.startsWith('ppt/notesSlides/')), 'speaker notes removed (default)');
check(!names.some((n) => /comment|authors\.xml/i.test(n)), 'reviewer comments and comment authors removed');
check(!names.includes('docProps/thumbnail.jpeg'), 'source deck cover thumbnail removed');
const core = await zip.file('docProps/core.xml')!.async('string');
check(!/M Moser|Alegria/i.test(core) && core.includes('<dc:creator>SlideVault</dc:creator>'), 'author fields replaced with "SlideVault"');
const app = await zip.file('docProps/app.xml')!.async('string');
check(!app.includes('Slide Titles') && app.includes('<Slides>3</Slides>'), 'properties no longer list the source deck\'s slide titles');

// Every relationship target must exist (otherwise PowerPoint offers to "repair" the file).
let dangling = 0;
for (const relsName of names.filter((n) => n.endsWith('.rels'))) {
  const owner = relsName.replace(/_rels\/([^/]+)\.rels$/, '$1').replace(/^_rels\/\.rels$/, '');
  const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
  const xml = await zip.file(relsName)!.async('string');
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    if (/TargetMode="External"/.test(m[0])) continue;
    const target = m[0].match(/Target="([^"]+)"/)![1];
    const parts: string[] = [];
    for (const seg of (target.startsWith('/') ? target.slice(1) : base + target).split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    if (!zip.file(parts.join('/'))) dangling++;
  }
}
check(dangling === 0, 'no broken internal references (no "repair" prompt)', `${dangling} dangling`);
const ct = await zip.file('[Content_Types].xml')!.async('string');
check(
  [...ct.matchAll(/PartName="\/([^"]+)"/g)].every((m) => !!zip.file(m[1])),
  'content-type list matches the parts that remain',
);
console.log(`      size: ${(out.length / 1024).toFixed(0)} KB for 3 slides (source ${(source.length / 1024 / 1024).toFixed(1)} MB)`);

// --- hidden slide selected becomes visible ----------------------------------------------------
const hiddenNumber = slides.find((s) => s.hidden)!.number;
const hiddenOut = await listSlides(await exportSelectedSlides(source, [hiddenNumber]));
check(hiddenOut.length === 1 && !hiddenOut[0].hidden, `hidden source slide ${hiddenNumber} is visible when selected`);

// --- validation ---------------------------------------------------------------------------------
for (const [bad, label] of [
  [[], 'empty selection'],
  [[0], 'slide 0'],
  [[99], 'slide 99'],
  [[1.5], 'non-integer'],
  [[1, 1], 'duplicate slide'],
] as const) {
  try {
    await exportSelectedSlides(source, [...bad]);
    check(false, `rejects ${label}`);
  } catch (e) {
    check(e instanceof ExportValidationError, `rejects ${label} with a clear message`, (e as Error).message);
  }
}

check(sha(new Uint8Array(readFileSync(SOURCE_DECK.path))) === sourceHash, 'source deck unchanged (SHA-256 identical)');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll export checks passed');
process.exit(failures ? 1 : 0);
