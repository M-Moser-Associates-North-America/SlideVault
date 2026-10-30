/**
 * Read deck details from where a deck sits in the SharePoint library (docs/foundry/SLIDE_RECORD.md:
 * deck fields come from the folder path). Works for the layouts we expect:
 *
 *   Submittals/2024/Northwind Bank/deck.pptx         -> year 2024, client Northwind Bank
 *   Best of the Best/IDD/deck.pptx                   -> Best of the Best, category IDD
 *   Best of the Best/2024/Northwind Bank/deck.pptx   -> Best of the Best, year 2024, client Northwind Bank
 *   Design Consultancy/2026/M Moser_Sprocket_SF_2026.pptx -> category Design Consultancy, year 2026, client Sprocket
 *                                                         (the first real decks, Oct 2026)
 *
 * Falls back to the file name for anything the folders don't say: "Client - Category.pptx", or
 * M Moser's own naming, "M Moser_<Client>_<place or RFP>_<date>.pptx" (client = the part after
 * "M Moser_", kept as written; the year from the date at the end, e.g. 06202025 or 071526; RFP or
 * MSA in the name as the category). PDFs are read the same way.
 * Anything still unknown comes back null, never guessed. The real folder names are an open
 * question for Alina; adding a layout is a change here only.
 */
export type FolderInfo = {
  folderPath: string;
  clientName: string | null;
  deckYear: number | null;
  category: string | null;
  bestOfTheBest: boolean;
  /** Where the client is, from a city code or name in the file name ("NY", "SF", "Vancouver"); null when it doesn't say */
  location: string | null;
};

/** City codes and names M Moser's file names use for where the client is */
const PLACES: Record<string, string> = {
  ny: 'New York', nyc: 'New York', 'new york': 'New York',
  sf: 'San Francisco', sfo: 'San Francisco', 'san francisco': 'San Francisco',
  to: 'Toronto', toronto: 'Toronto',
  vc: 'Vancouver', van: 'Vancouver', vancouver: 'Vancouver',
  la: 'Los Angeles', chi: 'Chicago', chicago: 'Chicago', bos: 'Boston', boston: 'Boston', sea: 'Seattle', seattle: 'Seattle',
  global: 'Global', americas: 'Americas',
};

const CATEGORY_NAMES: Record<string, string> = {
  idd: 'IDD',
  msa: 'MSA',
  'business proposal': 'Business Proposal',
  'business proposals': 'Business Proposal',
  sme: 'SME',
  'design consultancy': 'Design Consultancy',
  rfp: 'RFP',
};
/** "Design Consultancy 2" is a second folder of the same kind, not a different category. */
const categoryOf = (folder: string) => CATEGORY_NAMES[folder.trim().toLowerCase().replace(/\s+\d+$/, '')] ?? null;

/** The year in a file name's last date: 2025, 06202025 (MMDDYYYY or DDMMYYYY), 071526 (MMDDYY). */
function yearFromName(tokens: string[]): number | null {
  for (const t of [...tokens].reverse()) {
    const d = /^\d+$/.test(t) ? t : null;
    if (!d) continue;
    const y = d.length === 4 ? Number(d) : d.length >= 8 ? Number(d.slice(-4)) : d.length === 6 ? 2000 + Number(d.slice(-2)) : NaN;
    if (y >= 1900 && y <= 2099) return y;
  }
  return null;
}

/** relativePath: the deck's path inside the library, with / or \ between folders. */
export function folderInfo(relativePath: string): FolderInfo {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const fileName = parts.pop() ?? '';
  const info: FolderInfo = { folderPath: [...parts, fileName].join('/'), clientName: null, deckYear: null, category: null, bestOfTheBest: false, location: null };

  parts.forEach((part, i) => {
    const low = part.trim().toLowerCase();
    if (low === 'best of the best') info.bestOfTheBest = true;
    else if (categoryOf(part)) {
      info.category = categoryOf(part);
      // "Design Consultancy 2025": a category folder for one year (M Moser's Drive, Oct 2026)
      const year = /\s((?:19|20)\d\d)$/.exec(part.trim());
      if (year && !info.deckYear) info.deckYear = Number(year[1]);
    }
    else if (/^(19|20)\d\d$/.test(part.trim())) {
      info.deckYear = Number(part.trim());
      // The folder after the year is the client or project
      if (i + 1 < parts.length) info.clientName = parts[i + 1].trim();
    }
  });

  const stem = fileName.replace(/\.(pptx|pdf)$/i, '');
  const dash = stem.indexOf(' - ');
  if (dash > 0) {
    const nameClient = stem.slice(0, dash).trim();
    const nameCategory = stem.slice(dash + 3).trim().toLowerCase();
    info.clientName ??= nameClient;
    if (!info.category && CATEGORY_NAMES[nameCategory]) info.category = CATEGORY_NAMES[nameCategory];
  }
  // M Moser's naming: "M Moser_<Client>_<place or RFP>_<date>"
  // "Barlow_s": file names swap an apostrophe for an underscore, so a lone "s" after it is "'s".
  // A copy number in the name ("NYL(2)") isn't part of the client.
  const mm = /^m\s*moser\s*_\s*([^_]+?)(_s(?=_|$))?\s*(?:_|$)/i.exec(stem);
  if (mm && !info.clientName) info.clientName = (mm[1].replace(/\s*\(\d+\)\s*/g, ' ').trim() || mm[1].trim()) + (mm[2] ? "'s" : '');
  // A kind glued to the client ("FerrousMSA") is the kind, not part of the name.
  const glued = info.clientName ? /^(.+?[a-z])(MSA|RFP)$/.exec(info.clientName) : null;
  if (glued && mm) {
    info.clientName = glued[1];
    info.category ??= CATEGORY_NAMES[glued[2].toLowerCase()];
  }
  if (mm || /^mmoser_/i.test(stem)) {
    const tokens = stem.split('_').map((t) => t.replace(/\(\d+\)/g, '').trim());
    if (!info.clientName && /^mmoser$/i.test(tokens[0]) && tokens[1]) info.clientName = tokens[1];
    info.deckYear ??= yearFromName(tokens);
    info.location ??= tokens.slice(2).map((t) => PLACES[t.toLowerCase()] ?? null).find(Boolean) ?? null;
    info.category ??= tokens.slice(1).map((t) => CATEGORY_NAMES[t.toLowerCase().replace(/msa$/, 'msa').split(' ').pop() ?? ''] ?? null).find(Boolean) ?? null;
  }
  return info;
}
