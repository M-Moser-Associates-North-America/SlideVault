import 'server-only';
import type { IndexedSource } from '../library-repository';

/**
 * Deck sections, the "page breakers" (docs/DECISIONS.md FD-57). M Moser decks are split into
 * sections, each opened by a divider slide ("01 Firm profile", "SECTION 02 Case Studies") and
 * usually listed on a contents page ("What's inside: 01 Firm Qualifications, 02 Case Studies…").
 * Every slide belongs to the section it sits in, so a search for "resumes" or "case studies" can
 * find that part of every deck (Alina and Gabby, 28 Oct). Rules only, read from the slides' own
 * words and the reviewed slide types; no model.
 */

export type SectionKind = 'firm' | 'case-studies' | 'approach' | 'team' | 'fees' | 'understanding' | 'appendix' | 'other';

export type SlideSection = {
  /** The section's name as the deck says it ("Firm Qualifications", "Relevant experience") */
  name: string;
  /** The standard section it is, so different wordings meet ("How we think" is the firm overview) */
  kind: SectionKind;
  /** Every standard section the name fits: "Firm background / relevant experience" is both */
  kinds: SectionKind[];
  /** This slide opens the section (the divider, the "cover" of that part) */
  divider: boolean;
  dividerId: string;
  /** Where the slide sits in its section: 0 is the divider, 1 the slide after it */
  position: number;
};

/** Standard sections, as decks and searches word them. Order matters: the first that fits wins. */
export const SECTION_WORDS: [SectionKind, RegExp][] = [
  // "How we will run the portfolio" is the approach, not the portfolio.
  ['approach', /^how we\b(?!['’]?ve)/],
  ['case-studies', /\b(case stud(y|ies)|relevant experience|similar experience|project experience|where (we|our team)( ha)?'?v?e? done|done (this|it) before|portfolio|references|past projects|our work)\b/],
  ['team', /\b(team|resumes?|cvs?|bios?|personnel|staffing|experts?|people|who you'?ll work with|organi[sz]ation(al)? chart)\b/],
  ['fees', /\b(fees?|pricing|commercials?|cost proposal|budget|schedule and fees|fees and schedule)\b/],
  ['approach', /\b(approach|methodology|how we (do it|work|will|deliver)|process|delivery model|work ?plan|our thinking|implementation)\b/],
  ['firm', /\b(firm|company) (profile|overview|qualifications?|background|information)\b|\b(about (us|m ?moser)|who we are|who is m ?moser|how we think|our firm|firm overview|overview of m ?moser)\b/],
  ['understanding', /\b(understanding|executive summary|vision|your (needs|goals|brief)|project summary|the opportunity|initial thoughts|solving for)\b/],
  ['appendix', /\bappendix\b/],
];

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, "'");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Every standard section a name (or a search) means, best first; an appendix only when it is nothing else. */
export function sectionKinds(text: string): SectionKind[] {
  const t = plain(text);
  if (SECTION_WORDS[0][1].test(t)) return ['approach'];
  const all = [...new Set(SECTION_WORDS.filter(([, re]) => re.test(t)).map(([k]) => k))];
  const named = all.filter((k) => k !== 'appendix');
  return named.length ? named : all.length ? all : ['other'];
}

export const sectionKind = (text: string): SectionKind => sectionKinds(text)[0];

/** A section marker on its own: "01", "01/", "Section 00", "2025 01", a page number. */
const MARKER = /^((section|part)\s+)?[0-9]{1,3}\/?$|^20\d\d(\s+\d{1,2})?$|^[A-H]$/i;
/** A line that carries on the one before: lower case ("thoughts", "of willowfit"), or after "of", "&", "we're", a possessive. */
const CARRIES_ON = (prev: string, line: string) => /^[a-z]/.test(line) || /(\bof|\band|&|\bthe|\bto|\bfor|\bour|\bwe['’](re|ve)|['’]s)$/i.test(prev);

/**
 * The section's name from its divider, skipping what every page carries (the RFP's running header,
 * "M Moser Associates x Willowfit", "Section 00", "2025 01"): "Section 00 / Our / understanding / of
 * willowfit" -> "Our understanding of willowfit"; "4 / Firm / Background / Information" -> "Firm Background".
 */
function dividerName(title: string, text: string, seen: Map<string, number>, slideCount: number): string {
  const furniture = (l: string) => (seen.get(plain(l)) ?? 0) >= Math.max(3, slideCount * 0.6);
  let raw = `${text.includes(title.trim()) ? '' : `${title}\n`}${text}`.split('\n').map((l) => l.trim());
  // "SSC Designer … RFP / M Moser x Willowfit / Section 00 / Our / understanding": when what comes
  // before "Section 00" is a document title printed on every divider, the name is what comes after it.
  const at = raw.findIndex((l) => /^(section|part)\s+0?\d{1,2}$/i.test(l));
  if (at > 0 && raw.slice(0, at).some((l) => words(l) >= 5 && !/\s[xX]\s/.test(l) && (seen.get(plain(l)) ?? 0) >= 3)) raw = raw.slice(at + 1);
  const lines = raw
    .map((l) => l.trim().replace(/^((section|part)\s+)?0?\d{1,2}\s*[/.):-]\s*/i, '').replace(/^0?\d{1,2}\s+(?=[A-Za-z])/, '').trim())
    .filter((l) => l && !MARKER.test(l) && !furniture(l) && !/\s[xX]\s/.test(l) && !/^[A-H]\s+[A-Z]{3,}.*[A-Z]{3,}/.test(l));
  let name = '';
  for (const line of lines) {
    const clean = undouble(line);
    if (!name) name = clean;
    else if (plain(name).includes(plain(clean))) continue;
    else if (words(name) < 2 || CARRIES_ON(name, clean)) name = `${name} ${clean}`;
    else break;
    if (words(name) >= 6) break;
  }
  // "team I Architect & design consultant RFP…", "appendix • Team Resumes": the name ends at a separator.
  return tidy((name || title).split(/\s+(?:\||•|I|–|—)\s+/)[0]);
}

/** Overlapping text boxes double words: "MEET THE MEET THE TEAM" -> "MEET THE TEAM", "ABOUT ABOUT M MOSER" -> "ABOUT M MOSER". */
function undouble(line: string): string {
  let w = line.split(/\s+/);
  for (let n = 3; n >= 1; n--) for (let i = 0; i + 2 * n <= w.length; i++) if (w.slice(i, i + n).join(' ').toLowerCase() === w.slice(i + n, i + 2 * n).join(' ').toLowerCase()) w = [...w.slice(0, i + n), ...w.slice(i + 2 * n)];
  return w.join(' ');
}

const tidy = (s: string) => {
  const x = s.replace(/\s+/g, ' ').trim().slice(0, 60);
  return x === x.toUpperCase() ? x.charAt(0) + x.slice(1).toLowerCase() : x;
};

/** Lines on most of a deck's slides are its running header, not a section's name (a section's own heading repeats only on its pages). */
function lineCounts(source: Pick<IndexedSource, 'slides'>): Map<string, number> {
  const count = new Map<string, number>();
  for (const s of source.slides) for (const l of new Set(s.text.split('\n').map((x) => plain(x.trim())).filter(Boolean))) count.set(l, (count.get(l) ?? 0) + 1);
  return count;
}

/** Entries on a contents page ("What's inside", "Table of contents"), lower case, numbers off. */
function contentsEntries(text: string): string[] {
  if (!/\b(what'?s inside|table of contents|contents|agenda)\b/.test(plain(text))) return [];
  return text
    .split('\n')
    .map((l) => plain(l).replace(/^(section\s+)?[0-9a-h]{1,2}[\s./):-]+/, '').trim())
    .filter((l) => l.length >= 4 && l.length <= 50 && !/\b(what'?s inside|table of contents|contents|agenda)\b/.test(l) && !/^\d+$/.test(l));
}

/**
 * Is this slide a divider? Reviewed as one; or a short slide titled like one ("01 Firm profile",
 * "SECTION 02"); or a PDF page whose lettered heading changes ("C DESCRIPTION OF FIRM'S APPROACH").
 */
function looksLikeDivider(title: string, text: string, reviewedType: string | undefined, contents: string[]): boolean {
  if (reviewedType === 'section_divider') return true;
  if (reviewedType && reviewedType !== 'cover' && reviewedType !== 'blank_or_placeholder') return false;
  const short = words(text) <= 30;
  const t = title.trim();
  if (short && /^(section\s+)?0?\d{1,2}([\s./):-]+[A-Za-z]|$)/i.test(t) && !/^\d+\s*(%|sq|ft|k\b|m\b|years?)/i.test(t)) return true;
  if (short && /\bsection\s+0?\d{1,2}\b/i.test(text)) return true;
  if (short && contents.includes(plain(t))) return true;
  return false;
}

/** Each slide's section, for one deck, in slide order. Slides before the first divider have none. */
export function deckSections(source: Pick<IndexedSource, 'slides'>, typeOf: (slideId: string) => string | undefined = () => undefined): Map<string, SlideSection> {
  const out = new Map<string, SlideSection>();
  const contents = source.slides.slice(0, 15).flatMap((s) => contentsEntries(`${s.title}\n${s.text}`));
  const seen = lineCounts(source);
  let current: Omit<SlideSection, 'divider' | 'position'> | null = null;
  let position = 0;
  let lastLetter: string | null = null;
  for (const slide of source.slides) {
    const type = typeOf(slide.id);
    // PDFs repeat a lettered heading on every page of a section ("F PROPOSED TEAM AND RESUMES …"): a new letter is a new section.
    const letter = /^([A-H])\s+[A-Z]{3,}/.exec(slide.title.trim())?.[1] ?? null;
    const opensByLetter = letter !== null && letter !== lastLetter;
    if (letter) lastLetter = letter;
    if (opensByLetter || looksLikeDivider(slide.title, slide.text, type, contents)) {
      const name = dividerName(slide.title, slide.text, seen, source.slides.length);
      // A header repeated on the section's pages ("HOW WE WILL ACHIEVE MERIDIAN'S AMBITIONS") doesn't start it again.
      if (!current || plain(name) !== plain(current.name)) {
        const kinds = sectionKinds(name);
        current = { name, kind: kinds[0], kinds, dividerId: slide.id };
        position = 0;
        out.set(slide.id, { ...current, divider: true, position });
        continue;
      }
    }
    if (current) out.set(slide.id, { ...current, divider: false, position: ++position });
  }
  return out;
}

/** Each slide's section across the library, worked out once per library load. */
const cache = new WeakMap<object, Map<string, SlideSection>>();
export function librarySections(index: { sources: Pick<IndexedSource, 'slides'>[] } | null, typeOf: (slideId: string) => string | undefined): Map<string, SlideSection> {
  if (!index) return new Map();
  const have = cache.get(index);
  if (have) return have;
  const all = new Map<string, SlideSection>();
  for (const source of index.sources) for (const [id, sec] of deckSections(source, typeOf)) all.set(id, sec);
  cache.set(index, all);
  return all;
}

/** A search that asks for a part's cover: "banner slides", "case study covers", "the page breakers". */
export const asksForCover = (query: string) => /\b(banners?|covers?|dividers?|page ?break(er)?s?|section (covers?|breaks?|openers?)|title slides?)\b/i.test(query);

/**
 * A search that is only a section ("firm overview", "resumes", "case studies", "banner slides in case
 * studies"), with nothing else named: it wants that part of every deck, one deck after another.
 */
export function isSectionSearch(query: string): boolean {
  if (!askedSections(query).length) return false;
  let rest = plain(query);
  for (const [, re] of SECTION_WORDS) rest = rest.replace(new RegExp(re.source.replace(/^\^/, ''), 'g'), ' ');
  rest = rest.replace(/\b(banners?|covers?|dividers?|page ?break(er)?s?|sections?|title|slides?|decks?|pages?|show|me|find|the|our|all|a|an|in|of|for|from|any|some|please|i|need|want|looking|look|good|best)\b/g, ' ');
  return !/[a-z0-9]{3,}/.test(rest);
}

/** The sections a search asks for ("resumes", "case studies", "our firm's value proposition"), none for "2026". */
export const askedSections = (query: string): SectionKind[] => sectionKinds(query).filter((k) => k !== 'other' && k !== 'understanding');

const KIND_SAID: Record<SectionKind, string> = { firm: 'firm overview', 'case-studies': 'case studies', approach: 'approach', team: 'team and résumés', fees: 'fees', understanding: 'client understanding', appendix: 'appendix', other: '' };

/** "In the Case Studies section (case studies)." for the why line; the deck's own name for the section first. */
export function sectionWhy(sec: SlideSection | undefined, asked: SectionKind[], cover: boolean): string | null {
  if (!sec) return null;
  const fits = sec.kinds.find((k) => asked.includes(k));
  if (!fits) return null;
  const said = KIND_SAID[fits];
  const own = plain(sec.name) === plain(said) ? '' : ` (${said})`;
  return sec.divider && cover ? `The cover of the “${sec.name}” section${own}.` : `In the “${sec.name}” section${own}.`;
}
