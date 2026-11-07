/**
 * The client's sector, read from plain words, so proof from the same kind of client leads ("hospital" ->
 * healthcare) and "hospitality decks" finds the decks made for hospitality clients (FD-87). Matched
 * against the sectors on reviewed slides (FD-28), which start with these names ("healthcare / medtech").
 * Rules only, no model. Shared by the server and the deck finder in the browser.
 */
export const SECTOR_WORDS: [string, RegExp][] = [
  ['healthcare', /\b(hospitals?|clinics?|clinical|patients?|health ?care|healthcare|medical|pharma\w*|biotech|life sciences|medtech|nurses?|doctors?)\b/],
  ['financial services', /\b(banks?|banking|financial|insurers?|insurance|asset manag\w+|investment|fintech|wealth)\b/],
  ['legal', /\b(law firms?|legal|lawyers?|attorneys?)\b/],
  // "Smart building technology" is a theme, not a sector: only a tech client counts.
  ['technology', /\b((tech|technology) (company|companies|firm|client|group)|software|saas|semiconductors?)\b/],
  // Not "studios": at M Moser that's their own offices ("a global network of studios", 5 Nov).
  ['media', /\b(media|broadcast\w*|publish\w*|newsroom)\b/],
  ['retail', /\b(retail\w*|consumer brands?|fashion|apparel)\b/],
  ['gaming', /\b(gaming|games|game studios?)\b/],
  ['hospitality', /\b(hospitality|hotels?|hoteliers?|resorts?)\b/],
  ['professional services', /\b(consult\w+|accounting|professional services)\b/],
  ['resources', /\b(mining|energy|oil|gas|resources)\b/],
];

export function clientSectors(text: string): string[] {
  const t = text.toLowerCase();
  return SECTOR_WORDS.filter(([, re]) => re.test(t)).map(([name]) => name);
}

/** Does a recorded sector ("financial services / media") count as one of these names? */
export const inSectors = (recorded: string | null | undefined, names: string[]): boolean =>
  !!recorded && recorded.split('/').some((part) => names.some((n) => part.trim().toLowerCase().startsWith(n)));

/**
 * Sectors named outright, by the first word of their name ("technology decks", "media proposals"). Only used
 * where decks are asked for: in a slide search, "smart building technology" is a theme, not a tech client.
 */
export function sectorsNamed(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z ]/g, ' ')} `;
  return SECTOR_WORDS.map(([name]) => name).filter((name) => t.includes(` ${name.split(' ')[0]} `) || (name === 'technology' && t.includes(' tech ')));
}
