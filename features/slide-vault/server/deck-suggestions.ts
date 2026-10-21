import JSZip from 'jszip';
import type { ExtractedSlide } from '../../../workers/slide-vault/processors/extract-text';
import { folderInfo } from './folder-path';

/**
 * Deck facts filled in from the .pptx itself (docs/DECISIONS.md FD-23): the folder, the file name,
 * the file's own properties (who made it, when it was saved) and the cover slides. Every value is
 * a suggestion with where it came from, for the person uploading to confirm or change; nothing
 * here is saved on its own. Rules run first and are free; an AI reader (ai/deck-facts.ts) only
 * fills what the rules left empty.
 */

export type FactSource = 'folder' | 'file name' | 'file properties' | 'slide text' | 'ai';
export type Suggested<T> = { value: T; source: FactSource; evidence: string };

export type DeckSuggestions = {
  client: Suggested<string> | null;
  year: Suggested<number> | null;
  category: Suggested<string> | null;
  bestOfTheBest: Suggested<boolean> | null;
  /** Who made the deck: the file's author */
  author: Suggested<string> | null;
  /** Who saved it last, when that's someone else */
  lastEditedBy: Suggested<string> | null;
  office: Suggested<string> | null;
};

export type FileProperties = { creator: string | null; lastModifiedBy: string | null; created: string | null; modified: string | null; title: string | null; company: string | null };

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`).exec(xml);
  const v = m ? decode(m[1]).trim() : '';
  return v || null;
};

/** The properties PowerPoint saves in every file (File > Info). Missing parts are null, never guessed. */
export async function readFileProperties(pptx: Uint8Array): Promise<FileProperties> {
  const zip = await JSZip.loadAsync(pptx);
  const core = (await zip.file('docProps/core.xml')?.async('string')) ?? '';
  const app = (await zip.file('docProps/app.xml')?.async('string')) ?? '';
  return {
    creator: tag(core, 'dc:creator'),
    lastModifiedBy: tag(core, 'cp:lastModifiedBy'),
    created: tag(core, 'dcterms:created'),
    modified: tag(core, 'dcterms:modified'),
    title: tag(core, 'dc:title'),
    company: tag(app, 'Company'),
  };
}

/** Names PowerPoint, templates and tools leave behind that aren't a real person (Steve Canny is python-pptx's default). */
const NOT_A_PERSON = /^(microsoft office user|office user|windows user|user|admin(istrator)?|author|owner|unknown|python-pptx|pptx|default|template|steve canny|.{0,1})$/i;
const person = (name: string | null, company: string | null) => {
  const n = name?.replace(/\s+/g, ' ').trim() ?? '';
  if (!n || NOT_A_PERSON.test(n) || /m\s*moser/i.test(n) || (company && n.toLowerCase() === company.toLowerCase())) return null;
  return n.slice(0, 80);
};

/** A plausible deck year: not before M Moser's digital archive, not after next year. */
const plausibleYear = (y: number, thisYear: number) => y >= 1990 && y <= thisYear + 1;

/** "M Moser_Client_SF_2026", "Deck 20240315", "Proposal-2025" -> the year in the file name. */
function yearInFileName(stem: string, thisYear: number): number | null {
  for (const m of stem.matchAll(/(?:^|[^0-9])((?:19|20)\d\d)(?:\d{2}){0,2}(?![0-9])/g)) {
    const y = Number(m[1]);
    if (plausibleYear(y, thisYear)) return y;
  }
  return null;
}

/** Cover-slide phrases that name who a deck is for. */
const FOR_CLIENT = /\b(?:prepared (?:exclusively )?for|presented to|proposal for|submitted to|a proposal to)\s*:?\s+([A-Z0-9][^.,;:|•\n]{1,60})/i;
/** Words that end a client name in running text ("Prepared for Northwind Bank by M Moser"). */
const NAME_ENDS = /\s+(?:by|from|on|in|at|for|with|and the|dated?)\b.*$/i;
const COVER_SLIDES = 3;

function clientInCover(slides: ExtractedSlide[]): Suggested<string> | null {
  for (const s of slides.slice(0, COVER_SLIDES)) {
    for (const text of [s.title, s.text]) {
      const m = FOR_CLIENT.exec(text ?? '');
      if (!m) continue;
      const name = m[1].replace(NAME_ENDS, '').split(/\s+/).slice(0, 6).join(' ').trim();
      if (name.length >= 2 && !/m\s*moser/i.test(name)) return { value: name, source: 'slide text', evidence: `Slide ${s.number}: "${m[0].trim().slice(0, 90)}"` };
    }
  }
  return null;
}

function yearInCover(slides: ExtractedSlide[], thisYear: number): Suggested<number> | null {
  for (const s of slides.slice(0, COVER_SLIDES)) {
    const years = [...`${s.title} ${s.text}`.matchAll(/\b((?:19|20)\d\d)\b/g)].map((m) => Number(m[1])).filter((y) => plausibleYear(y, thisYear));
    // The latest year on a cover is the submission year; earlier ones are usually history ("since 1981").
    if (years.length) return { value: Math.max(...years), source: 'slide text', evidence: `Slide ${s.number} mentions ${Math.max(...years)}` };
  }
  return null;
}

export type SuggestInput = { fileName: string; folderPath?: string | null; properties: FileProperties; slides: ExtractedSlide[]; thisYear?: number };

/**
 * The rules, in order of trust: the folder (M Moser's own filing), then the file name, then the
 * cover slides, then the file's properties. The first one that says something wins.
 */
export function suggestFromRules(input: SuggestInput): DeckSuggestions {
  const thisYear = input.thisYear ?? new Date().getFullYear();
  const path = input.folderPath?.trim() || input.fileName;
  const folder = folderInfo(path);
  const fromFolder = path.includes('/') || path.includes('\\');
  const where: FactSource = fromFolder ? 'folder' : 'file name';
  const stem = input.fileName.replace(/\.pptx$/i, '');
  const { properties: p } = input;

  const client: Suggested<string> | null = folder.clientName
    ? { value: folder.clientName, source: where, evidence: fromFolder ? `Folder: ${folder.folderPath}` : `File name: ${input.fileName}` }
    : clientInCover(input.slides);

  const nameYear = yearInFileName(stem, thisYear);
  const savedYear = Number(p.modified?.slice(0, 4) || p.created?.slice(0, 4));
  const year: Suggested<number> | null = folder.deckYear != null
    ? { value: folder.deckYear, source: where, evidence: `Folder: ${folder.folderPath}` }
    : nameYear != null
      ? { value: nameYear, source: 'file name', evidence: `File name: ${input.fileName}` }
      : yearInCover(input.slides, thisYear) ??
        (plausibleYear(savedYear, thisYear) ? { value: savedYear, source: 'file properties', evidence: `File last saved ${p.modified ?? p.created}` } : null);

  const author = person(p.creator, p.company);
  const editor = person(p.lastModifiedBy, p.company);
  return {
    client,
    year,
    category: folder.category ? { value: folder.category, source: where, evidence: fromFolder ? `Folder: ${folder.folderPath}` : `File name: ${input.fileName}` } : null,
    bestOfTheBest: folder.bestOfTheBest ? { value: true, source: 'folder', evidence: `Folder: ${folder.folderPath}` } : null,
    author: author ? { value: author, source: 'file properties', evidence: 'File author (File > Info in PowerPoint)' } : null,
    lastEditedBy: editor && editor !== author ? { value: editor, source: 'file properties', evidence: 'Last saved by (File > Info in PowerPoint)' } : null,
    office: null,
  };
}

/** What still needs filling after the rules, so an AI reader is asked only about those. */
export const missingFacts = (s: DeckSuggestions) => (['client', 'year', 'category', 'office'] as const).filter((k) => s[k] == null);
