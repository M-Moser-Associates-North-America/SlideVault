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
