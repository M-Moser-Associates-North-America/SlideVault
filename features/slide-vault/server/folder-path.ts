/**
 * Read deck details from where a deck sits in the SharePoint library (docs/foundry/SLIDE_RECORD.md:
 * deck fields come from the folder path). Works for the layouts we expect:
 *
 *   Submittals/2024/Northwind Bank/deck.pptx         -> year 2024, client Northwind Bank
 *   Best of the Best/IDD/deck.pptx                   -> Best of the Best, category IDD
 *   Best of the Best/2024/Northwind Bank/deck.pptx   -> Best of the Best, year 2024, client Northwind Bank
 *   Design Consultancy/2026/M Moser_Gusto_SF_2026.pptx -> category Design Consultancy, year 2026, client Gusto
 *                                                         (the first real decks, Oct 2026)
 *
 * Falls back to the file name for anything the folders don't say: "Client - Category.pptx", or
 * M Moser's own naming, "M Moser_<Client>_<place or RFP>_<date>.pptx" (client = the part after
 * "M Moser_", kept as written).
 * Anything still unknown comes back null, never guessed. The real folder names are an open
 * question for Alina; adding a layout is a change here only.
 */
export type FolderInfo = {
  folderPath: string;
  clientName: string | null;
  deckYear: number | null;
  category: string | null;
  bestOfTheBest: boolean;
};

const CATEGORY_NAMES: Record<string, string> = {
  idd: 'IDD',
  msa: 'MSA',
  'business proposal': 'Business Proposal',
  'business proposals': 'Business Proposal',
  sme: 'SME',
  'design consultancy': 'Design Consultancy',
};
/** "Design Consultancy 2" is a second folder of the same kind, not a different category. */
const categoryOf = (folder: string) => CATEGORY_NAMES[folder.trim().toLowerCase().replace(/\s+\d+$/, '')] ?? null;

/** relativePath: the deck's path inside the library, with / or \ between folders. */
export function folderInfo(relativePath: string): FolderInfo {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const fileName = parts.pop() ?? '';
  const info: FolderInfo = { folderPath: [...parts, fileName].join('/'), clientName: null, deckYear: null, category: null, bestOfTheBest: false };

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

  const stem = fileName.replace(/\.pptx$/i, '');
  const dash = stem.indexOf(' - ');
  if (dash > 0) {
    const nameClient = stem.slice(0, dash).trim();
    const nameCategory = stem.slice(dash + 3).trim().toLowerCase();
    info.clientName ??= nameClient;
    if (!info.category && CATEGORY_NAMES[nameCategory]) info.category = CATEGORY_NAMES[nameCategory];
  }
  // M Moser's naming: "M Moser_<Client>_<place or RFP>_<date>"
  const mm = /^m\s*moser\s*_\s*([^_]+?)\s*(?:_|$)/i.exec(stem);
  if (mm && !info.clientName) info.clientName = cleanClient(mm[1]);
  // No year folder: the year M Moser's naming puts at the end of the file name, either a date
  // (06202025, 17032026: the last four digits) or the year itself (_2026). Same rule as the
  // storyboard's deck catalog (FD-31). Six-digit dates (071526) are too ambiguous and stay unknown.
  if (!info.deckYear) {
    const end = /(?:^|[_\s])(?:\d{4})?((?:19|20)\d\d)(?:\s*\(\d+\))*$/.exec(stem.trim());
    if (end) info.deckYear = Number(end[1]);
  }
  return info;
}

/** "NYT(2)" -> "NYT", "StripeMSA" -> "Stripe": copy numbers and a category glued to the name aren't the client. */
function cleanClient(raw: string): string {
  const name = raw.replace(/\s*\(\d+\)\s*/g, ' ').trim().replace(/(?<=[a-z])(MSA|IDD|SME)$/, '').trim();
  return name || raw.trim();
}
