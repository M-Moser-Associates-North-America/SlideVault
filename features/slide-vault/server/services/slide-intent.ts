import 'server-only';
import { clientSectors } from '../../components/sectors';

/**
 * What a search asks for beyond its words (docs/DECISIONS.md FD-33): a kind of slide ("team slide",
 * "case study"), a client's sector ("for a bank") and a theme ("sustainability"). Matched against what
 * is known about each slide (reviewed metadata, FD-28, and the local model's reading, FD-26), so a
 * search finds a healthcare team slide, not any slide with "team" on it. Rules only, no model.
 */

/** Kinds of slide a search can ask for, best first: a "team slide" means the team structure before résumés */
const KINDS: { asks: RegExp; types: string[] }[] = [
  { asks: /\b(resumes?|cvs?|bios?)\b/, types: ['team_resume'] },
  { asks: /\b(team|people|org ?chart|staffing|who we are sending)\b/, types: ['team_structure', 'team_time_allocation', 'team_resume'] },
  // "the roles and responsibility slide" (Alina, 4 Nov): who does what on the project, a team structure page.
  { asks: /\b(roles? (and|&) responsibilit\w*|responsibilit(y|ies)|who does what|account structure|account leadership)\b/, types: ['team_structure', 'team_time_allocation'] },
  { asks: /\b(case stud(y|ies)|past (work|projects?)|done (this|it) before|portfolio|similar projects?)\b/, types: ['case_study_detail', 'case_study_hero', 'image_gallery', 'client_references'] },
  { asks: /\b(approach|process|methodology|how we (work|deliver))\b/, types: ['approach_process', 'process_technology', 'planning_testfit', 'risk_governance'] },
  { asks: /\b(fees?|pricing|commercials?|cost proposal)\b/, types: ['fees_commercial'] },
  { asks: /\b(references?|testimonials?)\b/, types: ['client_references'] },
  { asks: /\b(schedule|timeline|programme)\b/, types: ['schedule'] },
  { asks: /\b(about us|firm profile|who we are|our firm|company profile|company overview|firm overview|about m ?moser)\b/, types: ['firm_profile', 'differentiator'] },
  // Words BD uses for slides that frame a deck (Gaby, 28 Oct): banners and dividers, covers, endings, contents
  { asks: /\b(banners?|dividers?|section (break|breaker|header|title)s?|page breakers?)\b/, types: ['section_divider'] },
  // The 9 slide types in Alina's database the rules didn't know yet (3 Nov, #34 notes). Worded so they don't
  // catch sector words: "financial services", "legal client", "private equity" stay sectors.
  { asks: /\b(cover(ing)? letters?|intro(duction)? letters?)\b/, types: ['cover_letter'] },
  { asks: /\b(capabilit(y|ies)|what we offer|our services|service (offering|lines?))\b/, types: ['capability_service'] },
  { asks: /\b(our understanding|project understanding|understanding (of )?(the|your) (client|brief|needs|business)|client (needs|challenges?)|the brief)\b/, types: ['client_understanding'] },
  { asks: /\b(design concepts?|concept design|concepts?|mood ?boards?|look and feel|design direction)\b/, types: ['design_concept'] },
  { asks: /\b(scope( of (work|services))?|assumptions?|exclusions)\b/, types: ['scope_assumptions'] },
  { asks: /\b(certifications?|accreditations?|iso \d+|esg credentials)\b/, types: ['certifications_esg'] },
  { asks: /\b(awards?|accolades?|recognition)\b/, types: ['awards'] },
  { asks: /\b(rfp (worksheets?|responses?|questionnaires?|answers?)|questionnaires?|worksheets?)\b/, types: ['rfp_worksheet'] },
  { asks: /\b(legal (pages?|terms|information)|terms and conditions|t ?& ?cs?|insurance certificates?|contract terms|admin(istrative)? pages?)\b/, types: ['legal_admin'] },
  { asks: /\b(covers?|cover page|title slide|front page)\b/, types: ['cover'] },
  { asks: /\b(ending|end slide|closing|closer|thank you|final slide|last slide|back cover)\b/, types: ['closing'] },
  { asks: /\b(table of contents|contents|agenda)\b/, types: ['table_of_contents'] },
  { asks: /\b(client logos?|logo wall)\b/, types: ['client_logos'] },
  { asks: /\b(risk|governance)\b/, types: ['risk_governance'] },
];

/** Themes a search can ask for, as the reviewed metadata names them */
const THEMES: { asks: RegExp; theme: string }[] = [
  { asks: /\b(sustainab\w*|esg|net zero|carbon|leed|green)\b/, theme: 'sustainability / net zero' },
  { asks: /\b(well-?being|wellness|health and wellbeing|burn ?out)\b/, theme: 'health & wellbeing' },
  { asks: /\b(hybrid|flexible work\w*|return to (the )?office)\b/, theme: 'hybrid / flexible work' },
  { asks: /\b(workplace strategy|utili[sz]ation|space data)\b/, theme: 'workplace strategy & data' },
  { asks: /\b(cost certainty|budget|risk)\b/, theme: 'cost certainty & risk' },
  { asks: /\b(smart building|technology)\b/, theme: 'technology & smart building' },
  { asks: /\b(amenit\w*|hospitality)\b/, theme: 'amenities & hospitality' },
  { asks: /\b(brand\w*|identity)\b/, theme: 'brand experience' },
  // The curated themes the rules didn't know yet (3 Nov, #34 notes), spelled exactly as stored on slides.
  { asks: /\b(master ?plan\w*|portfolio strategy|real estate strategy|consolidat\w*)\b/, theme: 'masterplanning & portfolio strategy' },
  { asks: /\b(dei|d ?& ?i|inclusi\w*|diversity|belonging|neurodivers\w*)\b/, theme: 'inclusion & DEI' },
  { asks: /\b(global(-| )local|global delivery|multi-?country|global footprint)\b/, theme: 'global-local delivery' },
  { asks: /\b(vdc|bim|3d|digital twin|virtual design)\b/, theme: 'VDC / 3D process' },
  { asks: /\b(interconnecting stairs?|feature stairs?|staircases?|vertical connection)\b/, theme: 'interconnecting stair / vertical connection' },
  { asks: /\b(design ?(&|and) ?build|design-build|turnkey|idd|integrated design)\b/, theme: 'design & build delivery' },
  { asks: /\b(ai|artificial intelligence|machine learning)\b/, theme: 'AI' },
  { asks: /\b(heritage|adaptive reuse|historic building|listed building)\b/, theme: 'heritage / adaptive reuse' },
];

/**
 * How a slide LOOKS, as people ask for it ("the map with all our offices", "the slide that looks like a
 * waterfall", "Moira's photo"), matched against what the local vision model saw on each slide
 * (visual-scan.json). Words on a slide rarely say "map" or "photo"; the picture does. A "road map" is
 * a plan, not a map, and an "org chart" is not a chart.
 */
const LOOKS: { asks: RegExp; looks: string[] }[] = [
  { asks: /\b(?<!road\s)(world )?maps?\b/, looks: ['map'] },
  { asks: /\b(org(ani[sz]ation(al)?)? ?charts?|organograms?|reporting (lines?|structure)|account structure)\b/, looks: ['org chart'] },
  { asks: /\b(photos?|pictures?|portraits?|headshots?|images? of)\b/, looks: ['portrait photo', 'people grid', 'project photo'] },
  { asks: /\b(tables?|matri(x|ces)|grids?)\b/, looks: ['table'] },
  // A waterfall is a kind of process diagram: confirmed waterfalls lead, other diagrams still qualify (waterfall-check.json).
  { asks: /\b(waterfalls?|cascad\w*)\b/, looks: ['waterfall', 'process diagram'] },
  { asks: /\b(flow ?(chart|diagram)s?|process diagrams?|step diagrams?|diagrams?)\b/, looks: ['process diagram'] },
  { asks: /\b(timelines?|gantt)\b/, looks: ['timeline'] },
  { asks: /\b(?<!org )(?<!organi[sz]ation )(?<!organi[sz]ational )(charts?|graphs?|pie charts?|bar charts?)\b/, looks: ['chart or graph'] },
  { asks: /\b(floor ?plans?|plans? drawings?|test ?fits?)\b/, looks: ['floor plan'] },
  { asks: /\b(logo walls?|client logos?)\b/, looks: ['logo wall'] },
];

/** A word that asks for a look ("map", "org chart", "photo"), never a name the results must print (FD-86). */
export const isLookWord = (word: string): boolean => LOOKS.some((l) => l.asks.test(word.toLowerCase()));

/** The words of the look phrases in a request ("org chart" gives org and chart), so none of them is required as a name. */
export function lookWordsIn(query: string): Set<string> {
  const q = query.toLowerCase();
  const out = new Set<string>();
  for (const l of LOOKS) {
    const m = new RegExp(l.asks.source, 'g');
    for (const hit of q.matchAll(m)) hit[0].split(/[^a-z]+/).filter(Boolean).forEach((w) => out.add(w));
  }
  return out;
}

export type SearchIntent = { types: string[]; sectors: string[]; themes: string[]; looks: string[] };
export type KnownForSearch = { type?: string; sectors?: string[]; themes?: string[]; reuse?: string; flags?: string[]; clientSector?: string; looks?: string[] } | undefined;

export function searchIntent(query: string): SearchIntent {
  // Accents off, so "résumé" reads as "resume" (a regex word boundary doesn't see é as a letter).
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // A résumé search asks for résumés; otherwise the first kind the search names leads.
  const kinds = KINDS.filter((k) => k.asks.test(q));
  return {
    types: [...new Set(kinds.flatMap((k) => k.types))],
    sectors: clientSectors(query),
    themes: THEMES.filter((t) => t.asks.test(q)).map((t) => t.theme),
    looks: [...new Set(LOOKS.filter((l) => l.asks.test(q)).flatMap((l) => l.looks))],
  };
}

export const asksForAnything = (i: SearchIntent) => i.types.length + i.sectors.length + i.themes.length + i.looks.length > 0;

/** Does the slide look like what was asked for? Unknown (no visual reading yet) is not a no. */
export const looksRight = (i: SearchIntent, k: KnownForSearch): boolean | null =>
  !i.looks.length ? true : k?.looks?.length ? k.looks.some((l) => i.looks.includes(l)) : null;

/** Proof for a client in that sector, or any slide from a deck made for one ("a team slide for a healthcare client") */
const inSector = (i: SearchIntent, k: KnownForSearch) =>
  !!k && [...(k.sectors ?? []), ...(k.clientSector ? k.clientSector.split('/').map((x) => x.trim()) : [])].some((s) => i.sectors.some((f) => s.toLowerCase().startsWith(f)));

/** How much better a slide answers the search than its words alone say: the kind first, then sector and theme. */
export function intentScore(i: SearchIntent, k: KnownForSearch): number {
  if (!k) return 0;
  const at = k.type ? i.types.indexOf(k.type) : -1;
  // Never-show pages and copies that still name another client stay findable, just last.
  const doubtful = k.reuse === 'internal - never show' || !!k.flags?.some((f) => /names another client|leftover/i.test(f));
  // A résumé that only mentions a word in someone's bio isn't what a search for that word wants
  // (Alina, 28 Oct: "he just happened to mention hospitality in his interview"), unless it asks for people.
  const passingBio = k.type === 'team_resume' && !i.types.includes('team_resume') ? 4 : 0;
  // The look asked for outranks everything else: "the map with all our offices" wants maps, and office words only order them.
  // The look asked for first is the most specific ("waterfall" before "process diagram"): a slide that has it leads.
  const look = looksRight(i, k) === true && i.looks.length ? 10 + (i.looks.length > 1 && k.looks?.includes(i.looks[0]) ? 4 : 0) : 0;
  return (at < 0 ? 0 : 6 - Math.min(at, 2)) + (inSector(i, k) ? 3 : 0) + (k.themes?.some((t) => i.themes.includes(t)) ? 2 : 0) + look - (doubtful ? 6 : 0) - passingBio;
}

/** Does a slide answer what the search asks for at all (its kind, sector or theme)? */
export function answersIntent(i: SearchIntent, k: KnownForSearch): boolean {
  if (!k) return false;
  const kindOk = !i.types.length || (!!k.type && i.types.includes(k.type));
  const sectorOk = !i.sectors.length || inSector(i, k);
  const themeOk = !i.themes.length || !!k.themes?.some((t) => i.themes.includes(t));
  // A slide of the right look answers on its own ("maps" finds a map that only lists city names).
  if (i.looks.length && looksRight(i, k) === true) return sectorOk;
  return kindOk && sectorOk && themeOk && looksRight(i, k) !== false;
}

const KIND_SAID: Record<string, string> = {
  team_structure: 'A team slide',
  team_resume: 'A résumé',
  team_time_allocation: 'A team slide',
  case_study_detail: 'A case study',
  case_study_hero: 'A case study',
  image_gallery: 'Project pictures',
  client_references: 'Client references',
  approach_process: 'An approach slide',
  process_technology: 'An approach slide',
  planning_testfit: 'A planning slide',
  risk_governance: 'A risk and governance slide',
  fees_commercial: 'A fees slide',
  schedule: 'A schedule',
  firm_profile: 'About the firm',
  differentiator: 'What sets us apart',
  section_divider: 'A section banner',
  cover: 'A cover',
  closing: 'A closing slide',
  table_of_contents: 'A contents page',
  client_logos: 'A client logo wall',
  cover_letter: 'A cover letter',
  capability_service: 'A capability slide',
  client_understanding: 'A client understanding slide',
  design_concept: 'A design concept',
  scope_assumptions: 'A scope slide',
  certifications_esg: 'A certifications slide',
  awards: 'An awards slide',
  rfp_worksheet: 'An RFP worksheet',
  legal_admin: 'A legal or admin page',
};

/** What's known about a database slide (FD-51, FD-53), in the shape the intent rules read. */
export function knownFromStory(s: { story?: { type: string | null; sectors: string[]; themes: string[]; reuse: string | null; flags: string[] } | null }): KnownForSearch {
  const k = s.story;
  return k ? { type: k.type ?? undefined, sectors: k.sectors, themes: k.themes, reuse: k.reuse ?? undefined, flags: k.flags } : undefined;
}

/** One line on what the slide is, in the search's terms: "A case study for the same kind of client, on sustainability / net zero." */
export function intentWhy(i: SearchIntent, k: KnownForSearch): string | null {
  if (!k) return null;
  const kind = k.type && i.types.includes(k.type) ? KIND_SAID[k.type] : null;
  const sector = inSector(i, k) ? 'for the same kind of client' : null;
  const theme = k.themes?.find((t) => i.themes.includes(t));
  const look = k.looks?.find((l) => i.looks.includes(l));
  if (!kind && !sector && !theme && !look) return null;
  return `${[kind ?? (look ? `Looks like: ${look}` : 'A slide'), sector].filter(Boolean).join(' ')}${theme ? `, on ${theme}` : ''}.`;
}
