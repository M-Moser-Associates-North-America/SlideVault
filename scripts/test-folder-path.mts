/**
 * Folder-path checks against the synthetic SharePoint library's answer key.
 *
 *   npm run test:folder-path
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { folderInfo } from '../features/slide-vault/server/folder-path';

const LIBRARY = path.resolve(import.meta.dirname, '../tests/fixtures/sharepoint-library');
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

// Answer key columns: file, year, client, sector, category, slide_number, slide_type, best_of_the_best
const decks = new Map<string, string[]>();
for (const line of readFileSync(path.join(LIBRARY, 'answer_key.csv'), 'utf8').trim().split('\n').slice(1)) {
  const cols = line.trimEnd().split(',');
  decks.set(cols[0], cols);
}

// M Moser's real naming (first real decks, Oct 2026): category/year folders, client in the file name
for (const [file, want] of [
  ['Design Consultancy/2026/M Moser_Sprocket_SF_2026.pptx', { deckYear: 2026, clientName: 'Sprocket', category: 'Design Consultancy' }],
  ['Design Consultancy 2/2026/M Moser_Tidewater HQ_SF_071526.pptx', { deckYear: 2026, clientName: 'Tidewater HQ', category: 'Design Consultancy' }],
  ['Design Consultancy/2026/M Moser_Maplecrest_2026.pptx', { deckYear: 2026, clientName: 'Maplecrest', category: 'Design Consultancy' }],
  ['Design Consultancy/2026/M Moser Notes.pptx', { deckYear: 2026, clientName: null, category: 'Design Consultancy' }],
  ['Design Consultancy 2025/M Moser_Sprocket_SF_2025.pptx', { deckYear: 2025, clientName: 'Sprocket', category: 'Design Consultancy' }],
  ['MSA/M Moser_Acme_NY_2025.pptx', { deckYear: 2025, clientName: 'Acme', category: 'MSA' }],
  ['IDD/M Moser_Acme_2024.pptx', { deckYear: 2024, clientName: 'Acme', category: 'IDD' }],
  // Years and kinds from the name when no folder says them; PDFs and "MMoser_" too
  ['Proposals/M Moser_Acme_RFP_06202025.pdf', { deckYear: 2025, clientName: 'Acme', category: 'RFP' }],
  ['Proposals/M Moser_Northwind_RFP_17032026 (1).pptx', { deckYear: 2026, clientName: 'Northwind', category: 'RFP' }],
  ['Proposals/M Moser_Kestrel_MSA.pptx', { deckYear: null, clientName: 'Kestrel', category: 'MSA' }],
  ['Proposals/M Moser_TailspinMSA_SF_2025 (1).pptx', { deckYear: 2025, clientName: 'Tailspin', category: 'MSA' }],
  ['Proposals/MMoser_Fabrikam_2026 (1).pptx', { deckYear: 2026, clientName: 'Fabrikam', category: null }],
  ['Proposals/M Moser_Contoso_Vancouver_2025.pdf', { deckYear: 2025, clientName: 'Contoso', category: null }],
  // Real Drive file names (Oct 2026): copy numbers, Barlow_s, a year at the end of the name
  ['MSA/M Moser_Lumenwatch_Global_07102025.pptx', { deckYear: 2025, clientName: 'Lumenwatch', category: 'MSA' }],
  ['MSA/M Moser_Inkwise_RFP_17032026 (1).pptx', { deckYear: 2026, clientName: 'Inkwise', category: 'MSA' }],
  ['MSA/M Moser_FerrousMSA_SF_2025 (1) (1).pptx', { deckYear: 2025, clientName: 'Ferrous', category: 'MSA' }],
  ['SME/M Moser_NYL(2)_RFP_07292026 (1).pptx', { deckYear: 2026, clientName: 'NYL', category: 'SME' }],
  ['IDD/Maplecrest - Progressive Integrated Design and Build - March.pptx', { deckYear: null, clientName: 'Maplecrest', category: 'IDD' }],
  ['Design Consultancy 2025/2025 3/M Moser_Barlow_s_RFP_06202025.pptx', { deckYear: 2025, clientName: "Barlow's", category: 'Design Consultancy' }],
  ['Design Consultancy 2025/2025/MMoser_Bright Pixel Games (Arcadia)_VC.pptx', { deckYear: 2025, clientName: 'Bright Pixel Games (Arcadia)', category: 'Design Consultancy' }],
  ['Design Consultancy 2025/2025/M Moser_Project Kiwi_NY_RFP_2024.pptx', { deckYear: 2025, clientName: 'Project Kiwi', category: 'Design Consultancy' }],
] as const) {
  const got = folderInfo(file);
  check(got.deckYear === want.deckYear && got.clientName === want.clientName && got.category === want.category && !got.bestOfTheBest, `reads ${file}`, JSON.stringify(got));
}

for (const [file, [, year, client, , category, , , botb]] of decks) {
  const got = folderInfo(file);
  // Best of the Best/<category>/ has no year folder, so year is honestly unknown there
  const wantYear = file.startsWith('Best of the Best/') ? null : Number(year);
  const ok = got.deckYear === wantYear && got.clientName === client && got.category === category && got.bestOfTheBest === (botb === 'yes');
  check(ok, `reads ${file}`, JSON.stringify(got));
}

const alt = folderInfo('Best of the Best/2025/Lumen Biotech/Lumen Biotech - IDD.pptx');
check(alt.bestOfTheBest && alt.deckYear === 2025 && alt.clientName === 'Lumen Biotech' && alt.category === 'IDD',
  'reads the other layout: Best of the Best/<year>/<client>/', JSON.stringify(alt));
const win = folderInfo('Submittals\\2026\\Orbit Air\\Orbit Air - SME.pptx');
check(win.deckYear === 2026 && win.clientName === 'Orbit Air' && win.folderPath === 'Submittals/2026/Orbit Air/Orbit Air - SME.pptx',
  'handles Windows-style backslashes', JSON.stringify(win));
const bare = folderInfo('random deck.pptx');
check(bare.deckYear === null && bare.clientName === null && bare.category === null && !bare.bestOfTheBest,
  'a loose file with no folders or naming pattern stays unknown, not guessed', JSON.stringify(bare));

// Where the client is, from a city code in M Moser's file names (FD-35)
for (const [file, place] of [
  ['Proposals/M Moser_Acme_NY_RFP_2025.pdf', 'New York'],
  ['Proposals/M Moser_Acme_MSA_TO_2025.pptx', 'Toronto'],
  ['Proposals/MMoser_Acme_RFP Response_SFO_2025.pdf', 'San Francisco'],
  ['Proposals/M Moser_Acme_VC_2025.pdf', 'Vancouver'],
  ['Proposals/M Moser_Acme_RFP_06202025.pdf', null],
] as const) check(folderInfo(file).location === place, `reads where the client is from ${file}`, String(folderInfo(file).location));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll folder-path checks passed');
process.exit(failures ? 1 : 0);
