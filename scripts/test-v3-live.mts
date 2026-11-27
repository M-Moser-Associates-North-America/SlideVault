/**
 * V3 live-data checks.
 *
 *   npm run test:v3
 *
 *  - every addition finds its place in Khushali's V3 file (so a V3 edit can't silently drop live data)
 *  - V3's own file is unchanged in the repo; the additions only happen when /v3 is served
 *  - the page's JavaScript still parses after the additions
 *  - the library data is shaped the way the page expects, with duplicate groups marked
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { liveV3Page } from '../features/slide-vault/v3/live';
import { buildLibrary } from '../features/slide-vault/server/services/library';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

const file = path.resolve(import.meta.dirname, '../features/slide-vault/v3/SlideVault-v3.html');
const original = readFileSync(file, 'utf8');
const page = liveV3Page(original);

check(page.missing.length === 0, 'every live-data addition finds its place in V3', page.missing.join(', '));
check(page.html !== original && readFileSync(file, 'utf8') === original, "V3's own file stays unchanged; additions happen only when served");
check(page.html.includes('id="sv-v3-app"') && page.html.includes('window.SV_LIVE'), 'V3 waits for the data, then swaps it in');
check(page.html.includes('function liveDownload') && page.html.includes("/api/slide-vault/v1/exports"), 'the cart download calls the real export');

const scripts = [...page.html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let parses = true;
let why = '';
for (const code of scripts) {
  try {
    new Function(code);
  } catch (e) {
    parses = false;
    why = (e as Error).message;
  }
}
check(scripts.length >= 2 && parses, `the page's JavaScript still parses (${scripts.length} scripts)`, why);

const broken = liveV3Page(original.replace('function thumbSVG(id) {', 'function thumbSVG (id) {'));
check(broken.missing.length === 1 && broken.html === original.replace('function thumbSVG(id) {', 'function thumbSVG (id) {'),
  'if V3 changes so an addition no longer fits, the page falls back to V3 as it is');

const lib = buildLibrary([
  {
    decks: [
      { id: 'a', title: 'A', client: 'Kestrel Law', year: 2024, category: 'SME', bestOfTheBest: false, slideSize: '16:9', versionId: 'va', uploadedAt: null, source: 'upload' },
      { id: 'b', title: 'B', client: 'Orbit Telecom', year: 2025, category: 'SME', bestOfTheBest: true, slideSize: '4:3', versionId: 'vb', uploadedAt: null, source: 'upload' },
    ],
    slides: [
      { id: 'a1', deckId: 'a', slideNumber: 1, title: 'Our values', text: 'curiosity candour craft care and accountability guide every project', hiddenInSource: false, previewPath: '/slides/a1/preview' },
      { id: 'b1', deckId: 'b', slideNumber: 3, title: 'Our values', text: 'curiosity candour craft care and accountability guide every project', hiddenInSource: false, previewPath: '/slides/b1/preview' },
      { id: 'b2', deckId: 'b', slideNumber: 4, title: 'Thank you', text: 'Thank you', hiddenInSource: false, previewPath: '/slides/b2/preview' },
    ],
  },
]);
const g = (id: string) => lib.slides.find((s) => s.id === id)!.duplicateGroupId;
check(g('a1') !== null && g('a1') === g('b1') && g('b2') === null, 'the library marks copies of the same slide with one shared group');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll V3 live-data checks passed');
process.exit(failures ? 1 : 0);
