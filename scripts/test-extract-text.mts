/**
 * Reading words out of slides (workers/slide-vault/processors/extract-text.ts): a line break inside a
 * paragraph is a space, so titles like "Harbor Studio" + break + "Lisbon, Portugal" keep their space.
 *
 *   npm run test:extract
 */
import { paragraphText } from '../workers/slide-vault/processors/extract-text';

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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll extract-text checks passed');
process.exit(failures ? 1 : 0);
