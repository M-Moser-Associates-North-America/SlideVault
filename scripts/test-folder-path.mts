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
  ['Design Consultancy/2026/M Moser_Gusto_SF_2026.pptx', { deckYear: 2026, clientName: 'Gusto', category: 'Design Consultancy' }],
  ['Design Consultancy 2/2026/M Moser_Airwallex HQ_SF_071526.pptx', { deckYear: 2026, clientName: 'Airwallex HQ', category: 'Design Consultancy' }],
  ['Design Consultancy/2026/M Moser_Scotiabank_2026.pptx', { deckYear: 2026, clientName: 'Scotiabank', category: 'Design Consultancy' }],
  ['Design Consultancy/2026/M Moser Notes.pptx', { deckYear: 2026, clientName: null, category: 'Design Consultancy' }],
  ['Design Consultancy 2025/M Moser_Gusto_SF_2025.pptx', { deckYear: 2025, clientName: 'Gusto', category: 'Design Consultancy' }],
  // No year folder: the year comes from the end of M Moser's file name (Oct 2026 Drive folders)
  ['MSA/M Moser_Acme_NY_2025.pptx', { deckYear: 2025, clientName: 'Acme', category: 'MSA' }],
  ['IDD/M Moser_Acme_2024.pptx', { deckYear: 2024, clientName: 'Acme', category: 'IDD' }],
  ['MSA/M Moser_Datadog_Global_07102025.pptx', { deckYear: 2025, clientName: 'Datadog', category: 'MSA' }],
  ['MSA/M Moser_OpenText_RFP_17032026 (1).pptx', { deckYear: 2026, clientName: 'OpenText', category: 'MSA' }],
  ['MSA/M Moser_StripeMSA_SF_2025 (1) (1).pptx', { deckYear: 2025, clientName: 'Stripe', category: 'MSA' }],
  ['SME/M Moser_NYT(2)_RFP_07292026 (1).pptx', { deckYear: 2026, clientName: 'NYT', category: 'SME' }],
  ['IDD/Scotiabank - Progressive Integrated Design and Build - March.pptx', { deckYear: null, clientName: 'Scotiabank', category: 'IDD' }],
  ['Design Consultancy 2/2026/M Moser_Airwallex HQ_SF_071526.pptx', { deckYear: 2026, clientName: 'Airwallex HQ', category: 'Design Consultancy' }],
  ['MSA/M Moser_Acme_NY_071526.pptx', { deckYear: null, clientName: 'Acme', category: 'MSA' }],
  ['Design Consultancy 2025/2025 3/M Moser_Moody_s_RFP_06202025.pptx', { deckYear: 2025, clientName: "Moody's", category: 'Design Consultancy' }],
  ['Design Consultancy 2025/2025/MMoser_Next Level Games (Nintendo)_VC.pptx', { deckYear: 2025, clientName: 'Next Level Games (Nintendo)', category: 'Design Consultancy' }],
  ['Design Consultancy 2025/2025/M Moser_Project Mango_NY_RFP_2024.pptx', { deckYear: 2025, clientName: 'Project Mango', category: 'Design Consultancy' }],
  ['MSA/M Moser_Sesame_Street_2025.pptx', { deckYear: 2025, clientName: 'Sesame', category: 'MSA' }],
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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll folder-path checks passed');
process.exit(failures ? 1 : 0);
