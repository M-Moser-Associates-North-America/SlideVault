/**
 * Read deck details from where a deck sits in the SharePoint library (docs/foundry/SLIDE_RECORD.md:
 * deck fields come from the folder path). Works for the layouts we expect:
 *
 *   Submittals/2024/Northwind Bank/deck.pptx         -> year 2024, client Northwind Bank
 *   Best of the Best/IDD/deck.pptx                   -> Best of the Best, category IDD
 *   Best of the Best/2024/Northwind Bank/deck.pptx   -> Best of the Best, year 2024, client Northwind Bank
 *
 * Falls back to the file name ("Client - Category.pptx") for anything the folders don't say.
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
  'business proposal': 'Business Proposal',
  'business proposals': 'Business Proposal',
  sme: 'SME',
};

/** relativePath: the deck's path inside the library, with / or \ between folders. */
export function folderInfo(relativePath: string): FolderInfo {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const fileName = parts.pop() ?? '';
  const info: FolderInfo = { folderPath: [...parts, fileName].join('/'), clientName: null, deckYear: null, category: null, bestOfTheBest: false };

  parts.forEach((part, i) => {
    const low = part.trim().toLowerCase();
    if (low === 'best of the best') info.bestOfTheBest = true;
    else if (CATEGORY_NAMES[low]) info.category = CATEGORY_NAMES[low];
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
  return info;
}
