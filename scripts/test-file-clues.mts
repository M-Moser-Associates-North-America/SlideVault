/**
 * Looks from the deck file itself, saved at upload (docs/DECISIONS.md FD-100). No database, no model.
 *
 *   npm run test:file-clues
 *
 * The rules are the team's file-clue tool's (tools/file_clues.py in the data folder); on 11 Nov they gave the same
 * look as that tool on all 920 slides of the 40 real .pptx decks. These checks keep them that way.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { cluesFromXml, FILE_CLUE_LOOKS, fileClueLooks, looksFromClues } from '../workers/slide-vault/processors/file-clues';
import { extractSlides } from '../workers/slide-vault/processors/extract-text';
import { listSlides } from '../features/slide-vault/server/export-pptx';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const looks = (xml: string, smartart: string[] = [], text = '') => looksFromClues(cluesFromXml(xml, smartart, text));

// The rules, one at a time
check(same(looks('<p:sld><a:tbl></a:tbl></p:sld>'), ['table']), 'a real table is a table');
check(same(looks('<p:sld/>', ['orgChart1']), ['org chart']), 'a SmartArt org chart is an org chart');
check(same(looks('<p:sld/>', ['hierarchy2']), ['org chart']), 'a SmartArt hierarchy is an org chart');
check(same(looks('<p:sld/>', ['basicChevronProcess']), ['process diagram']), 'a SmartArt process is a process diagram');
check(same(looks('<p:sld/>', ['basicTimeline']), ['timeline']), 'a SmartArt timeline is a timeline');
const flow = '<p:sp>'.repeat(20) + '<p:cxnSp>'.repeat(8);
check(same(looks(flow), ['process diagram']), 'twenty shapes joined by eight arrows are a process diagram');
check(same(looks('<p:sp>'.repeat(19) + '<p:cxnSp>'.repeat(8)), []), 'nineteen shapes are not enough');
check(same(looks('<p:sp>'.repeat(20) + '<a:prstGeom prst="rightArrow"/>'.repeat(8)), ['process diagram']), 'arrow shapes count as connectors');
check(same(looks('<p:sld/>', [], "Cities we've done work in · M Moser offices"), ['map']), 'the office-map legend makes a map');
check(same(looks('<p:sld/>', [], 'Cities we’ve done work in'), ['map']), 'the legend with a curly apostrophe too');
check(same(looks('<a:tbl>', [], "Cities we've done work in"), ['table']), 'a table carrying the legend stays a table, not a map');
check(same(looks('<p:sld/>', [], 'New York San Francisco London Paris Dubai Sydney Singapore Shanghai Toronto'), []), 'a list of office cities alone is not a map');
check(same(looks('<p:sld><p:pic/></p:sld>', [], 'Our team'), []), 'a slide the file gives nothing away about gets no look');
check(looks('<a:tbl>' + flow, ['orgChart1'], "cities we've done work in").length <= 3, 'never more than three looks');
check([...FILE_CLUE_LOOKS].every((l) => ['table', 'org chart', 'process diagram', 'timeline', 'map'].includes(l)) && FILE_CLUE_LOOKS.size === 5,
  'the file-clue looks are exactly the five the rules can give (search reads any other look as a picture scan)');

// A whole deck, read the way an upload reads it
const FIXTURE = path.resolve(import.meta.dirname, '../tests/fixtures/northwind-capabilities.pptx');
const bytes = new Uint8Array(readFileSync(FIXTURE));
const slides = await extractSlides(bytes);
const texts = new Map(slides.map((s) => [s.number, s.text]));
const found = await fileClueLooks(bytes, texts);
const zip = await JSZip.loadAsync(bytes);
const tableSlides: number[] = [];
const parts = new Map((await listSlides(bytes)).map((s) => [s.number, s.part]));
for (const s of slides) {
  const xml = await zip.file(parts.get(s.number)!)?.async('string');
  if (xml?.includes('<a:tbl>')) tableSlides.push(s.number);
}
check(tableSlides.length > 0 && tableSlides.every((n) => same(found.get(n), ['table'])), 'the synthetic deck: its table slide is a table', JSON.stringify([...found]));
check([...found.keys()].every((n) => tableSlides.includes(n)), 'the synthetic deck: no other slide gets a look', JSON.stringify([...found]));

// The legend, as the upload passes each slide's own words
const legendText = new Map(texts);
const plain = slides.find((s) => !tableSlides.includes(s.number))!.number;
legendText.set(plain, `${texts.get(plain)} Cities we've done work in`);
check(same((await fileClueLooks(bytes, legendText)).get(plain), ['map']), 'a slide whose words carry the office-map legend becomes a map');

// SmartArt, found through the slide's relationships the way PowerPoint stores it
const withArt = await JSZip.loadAsync(bytes);
const relsPart = parts.get(plain)!.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels');
const rels = (await withArt.file(relsPart)?.async('string')) ?? '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
withArt.file(relsPart, rels.replace('</Relationships>', '<Relationship Id="rIdArt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout" Target="../diagrams/layout1.xml"/></Relationships>'));
withArt.file('ppt/diagrams/layout1.xml', '<dgm:layoutDef uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/orgChart1"/>');
const artBytes = await withArt.generateAsync({ type: 'uint8array' });
check(same((await fileClueLooks(artBytes, texts)).get(plain), ['org chart']), 'a slide using a SmartArt org chart layout becomes an org chart');

if (failures) {
  console.error(`\n${failures} file-clue check(s) failed`);
  process.exit(1);
}
console.log('\nAll file-clue checks passed');
