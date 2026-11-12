/**
 * What a slide looks like from clues in the PowerPoint file itself, with no AI and no picture (FD-86, FD-100):
 * a real table is a table, a SmartArt org chart is an org chart, a SmartArt process or timeline is that, many shapes
 * joined by arrows are a process diagram, and the office-map legend ("Cities we've done work in") is on every dark
 * world map and nothing else.
 *
 * The same rules as the team's file-clue tool (tools/file_clues.py in the data folder), moved here so every upload
 * gets them on any server. Pure functions over the package XML: nothing rendered, nothing sent, nothing executed.
 * The picture sorter and the describing model still decide photos, portraits and maps without the legend: they
 * need models, so they stay a separate, optional step.
 */
import JSZip from 'jszip';
import { listSlides } from '../../../features/slide-vault/server/export-pptx';

export type FileClues = {
  tables: number;
  smartart: string[];
  shapes: number;
  connectors: number;
  legend: boolean;
};

/**
 * Every look the file clues can give. Anything else (a project photo, a big statement, text only...) comes from the
 * picture sorter or the describing model, so a deck with such a look has had its pictures read; a deck with only
 * these has not, and search treats it as unscanned for photos and maps without the legend (FD-99, FD-100).
 */
export const FILE_CLUE_LOOKS: ReadonlySet<string> = new Set(['table', 'org chart', 'process diagram', 'timeline', 'map']);

/** The office-map legend: on every dark world map M Moser uses, and on no other slide (checked on the real library). */
const LEGEND = /cities we.ve done work in/i;

const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;

/** The SmartArt layout names a slide uses, e.g. "orgChart1" or "hierarchy2". */
async function smartArtLayouts(zip: JSZip, slidePart: string): Promise<string[]> {
  const relsPart = slidePart.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels');
  const rels = await zip.file(relsPart)?.async('string');
  if (!rels) return [];
  const names: string[] = [];
  for (const m of rels.matchAll(/Target="\.\.\/diagrams\/(layout\d*\.xml)"/g)) {
    const xml = await zip.file(`ppt/diagrams/${m[1]}`)?.async('string');
    if (xml === undefined) continue;
    const id = xml.match(/uniqueId="([^"]+)"/)?.[1] ?? m[1];
    names.push(id.split('/').pop()!);
  }
  return names;
}

/** What the file says about one slide's structure. */
export function cluesFromXml(slideXml: string, smartart: string[], text: string): FileClues {
  return {
    tables: count(slideXml, /<a:tbl>/g),
    smartart,
    shapes: count(slideXml, /<p:sp>/g),
    connectors: count(slideXml, /<p:cxnSp>/g) + count(slideXml, /prst="(?:\w*Arrow\w*|chevron|homePlate)"/g),
    legend: LEGEND.test(text),
  };
}

/** The looks the clues give, most telling first, at most three. Empty when the file gives nothing away. */
export function looksFromClues(c: FileClues): string[] {
  const look: string[] = [];
  if (c.tables) look.push('table');
  const art = c.smartart.join(' ').toLowerCase();
  if (/org|hierarch/.test(art)) look.push('org chart');
  else if (/process|cycle|chevron|arrow|funnel|step/.test(art)) look.push('process diagram');
  else if (/timeline/.test(art)) look.push('timeline');
  // A waterfall or flow: many small shapes joined by arrows.
  if (!look.includes('process diagram') && c.connectors >= 8 && c.shapes >= 20) look.push('process diagram');
  // A list of office cities alone is not enough (contact pages list them too); the legend is.
  if (c.legend && !look.includes('table')) look.unshift('map');
  return look.slice(0, 3);
}

/**
 * The file-clue looks for every slide of a deck, by slide number (the same numbering as extractSlides). Slides the
 * file says nothing about are left out. `texts` are the slides' extracted words, for the legend.
 */
export async function fileClueLooks(pptx: Uint8Array, texts: Map<number, string>): Promise<Map<number, string[]>> {
  const zip = await JSZip.loadAsync(pptx);
  const out = new Map<number, string[]>();
  for (const s of await listSlides(pptx)) {
    const xml = await zip.file(s.part)?.async('string');
    if (xml === undefined) continue;
    const look = looksFromClues(cluesFromXml(xml, await smartArtLayouts(zip, s.part), texts.get(s.number) ?? ''));
    if (look.length) out.set(s.number, look);
  }
  return out;
}
