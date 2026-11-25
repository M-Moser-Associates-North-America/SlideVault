/**
 * Reading words out of slides (workers/slide-vault/processors/extract-text.ts): a line break inside a
 * paragraph is a space, so titles like "Harbor Studio" + break + "Lisbon, Portugal" keep their space.
 * The Upload screen's preview (client/pptx-preview.ts) must read every synthetic deck exactly as ingest does.
 *
 *   npm run test:extract
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { readDeckPreview } from '../features/slide-vault/client/pptx-preview';
import { extractSlides, paragraphText } from '../workers/slide-vault/processors/extract-text';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);
}
const r = (t: string) => `<a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r>`;

const paired = paragraphText(`<a:p>${r('Harbor Studio')}<a:br><a:rPr lang="en-US"/></a:br>${r('Lisbon, Portugal')}</a:p>`);
check(paired === 'Harbor Studio Lisbon, Portugal', 'a line break (<a:br>...</a:br>) reads as a space', paired);
const selfClosing = paragraphText(`<a:p>${r("Lumen Labs")}<a:br/>${r('Oslo, Norway')}</a:p>`);
check(selfClosing === "Lumen Labs Oslo, Norway", 'a self-closing <a:br/> reads as a space too', selfClosing);
const runs = paragraphText(`<a:p>${r('Less ')}${r('searching.')}</a:p>`);
check(runs === 'Less searching.', 'words split across runs still join as written', runs);
const spaced = paragraphText(`<a:p>${r('Our team ')}<a:br/>${r(' in New York')}</a:p>`);
check(spaced === 'Our team in New York', 'no double spaces where a break sits next to a space', spaced);
check(paragraphText(`<a:p>${r('Fees &amp; rates')}</a:p>`) === 'Fees & rates', 'text is still decoded (&amp; is &)');
check(paragraphText('<a:p><a:br/></a:p>') === '', 'a paragraph that is only a break is empty');

// The browser preview and ingest give every synthetic deck the same titles and text (the preview runs here with a stand-in DOMParser).
(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
const fixtures = path.resolve('tests/fixtures');
const decks = (await readdir(fixtures, { recursive: true })).filter((f) => f.endsWith('.pptx'));
check(decks.length > 0, 'synthetic decks found in tests/fixtures');
/* The decks above have no line break inside a paragraph, so one more: the first slide of a synthetic deck, its first words followed by a break and "Studio". */
const zip = await JSZip.loadAsync(await readFile(path.join(fixtures, 'northwind-capabilities.pptx')));
const firstSlide = 'ppt/slides/slide1.xml';
zip.file(firstSlide, (await zip.file(firstSlide)!.async('string')).replace(/<\/a:t><\/a:r>/, '</a:t></a:r><a:br/><a:r><a:t>Studio</a:t></a:r>'));
const withBreak = await zip.generateAsync({ type: 'uint8array' });
for (const [deck, bytes] of [...decks.map((d) => [d, null] as const), ['northwind-capabilities.pptx with a line break', withBreak] as const]) {
  const data = bytes ?? new Uint8Array(await readFile(path.join(fixtures, deck)));
  const server = await extractSlides(data);
  const browser = (await readDeckPreview(new File([data as Uint8Array<ArrayBuffer>], path.basename(deck)))).slides;
  const differ = server.flatMap((s, i) => (s.title === browser[i]?.title && s.text === browser[i]?.text && s.hidden === browser[i]?.hidden ? [] : [s.number]));
  check(browser.length === server.length && differ.length === 0, `preview and ingest read ${deck} the same`, { slides: [browser.length, server.length], differ });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll extract-text checks passed');
process.exit(failures ? 1 : 0);
