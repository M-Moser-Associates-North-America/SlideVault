/**
 * Finding premade decks from a plain request (FD-31), on synthetic decks shaped like the real ones.
 *
 *   npm run test:deck-finder
 */
import { deckNames, findDecks, type FindableDeck } from '../features/slide-vault/components/deck-finder';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${JSON.stringify(detail)}` : ''}`);
}

const deck = (id: string, fileName: string, clientName: string | null, year: number | null, category: string | null, versionId = id): FindableDeck => ({ id, title: id, fileName, clientName, year, category, versionId });
const DECKS = [
  deck('kestrel-25', "Proposals/PDF/M Moser_Kestrel's_RFP_06202025.pdf", "Kestrel's", 2025, 'RFP'),
  deck('kestrel-26', 'Proposals/M Moser_Kestrel_MSA_2026.pptx', "Kestrel's", 2026, 'MSA'),
  deck('tailwind', 'Proposals/M Moser_TailwindGames_Vancouver_2025.pdf', 'Tailwind Games', 2025, 'RFP'),
  deck('fabrikam', 'Proposals/M Moser_Fabri_RFP_Global MSA_07022026.pptx', 'Fabrikam', 2026, 'MSA'),
  deck('contoso', 'Proposals/M Moser_Project Lime_NY_RFP_2025.pdf', 'Contoso (Project Lime)', 2025, 'RFP'),
  deck('northwind-a', 'Proposals/M Moser_Northwind_2025 (1).pptx', 'Northwind', 2025, null, 'v-north'),
  deck('northwind-b', 'Proposals/M Moser_Northwind_2025.pptx', 'Northwind', 2025, null, 'v-north'),
  deck('old', 'Archive/1995/Litware/M Moser_Litware_1995.pptx', 'Litware', 1995, null),
];
const ids = (q: string) => findDecks(q, DECKS, 2026).decks.map((d) => d.id);

check(JSON.stringify(ids("Kestrel's proposal 2025")) === '["kestrel-25"]', "a client and a year find that one deck");
check(JSON.stringify(ids('kestrels 2026')) === '["kestrel-26"]', 'the apostrophe is optional');
check(JSON.stringify(ids("Show me the Moser x Kestrel's presentation from 2025")) === '["kestrel-25"]', 'a sentence around the name still finds it');
check(JSON.stringify(ids("Kestrel's")) === '["kestrel-26","kestrel-25"]', "a client alone finds all its decks, newest first");
{
  const r = findDecks("Kestrel's proposal 2024", DECKS, 2026);
  check(r.yearMissing && r.decks.length === 2, "a year the client has no deck from shows its other decks and says so", r);
}
check(JSON.stringify(ids('Tailwind')) === '["tailwind"]', 'a distinctive first word stands for a longer client name');
check(ids('Contoso')[0] === 'contoso' && ids('Project').length === 0, 'a common first word never does');
check(JSON.stringify(ids('Tailwind Games')) === '["tailwind"]', 'a client written with spaces matches a file name without them');
check(JSON.stringify(ids('the Fabri deck')) === '["fabrikam"]', "the file's own name for a client finds it too");
check(JSON.stringify(ids('project lime')) === '["contoso"]', 'a project name in the client finds the deck');
check(JSON.stringify(ids('Northwind')) === '["northwind-a"]', 'two copies of one file show once');
check(JSON.stringify(ids('Show me all proposals from 2025').sort()) === '["contoso","kestrel-25","northwind-a","tailwind"]', 'all proposals from a year');
check(JSON.stringify(ids('MSAs from 2026').sort()) === '["fabrikam","kestrel-26"]', 'a kind and a year narrow it');
check(JSON.stringify(ids('Litware 1995')) === '["old"]', 'old decks are found the same way');
check(JSON.stringify(ids("Kestrel's from last year")) === '["kestrel-25"]', '"last year" is a year');
check(ids('hospital campus case study').length === 0, 'a slide search names no deck: no decks');
check(ids('workplace strategy 2025').length === 0, 'a topic with a year is a slide search, not every deck from that year');
check(!deckNames(DECKS[0]).includes('moser'), 'the firm\'s own name is never a client name');

// ---- What a storyboard request asks for (FD-31)
{
  const { deckRequest } = await import('../features/slide-vault/server/ai/deck-request');
  const mode = (q: string) => deckRequest(q, DECKS).mode;
  check(mode("Show me the Moser x Kestrel's presentation from 2025") === 'retrieve', 'retrieve: "show me the ... presentation from 2025"');
  check(mode("Retrieve the original Kestrel's proposal from last year") === 'retrieve', 'retrieve: "the original ... proposal"');
  check(mode("Kestrel's 2025") === 'retrieve', 'retrieve: a deck named on its own');
  check(mode("Tell me the story of Kestrel's using the presentation we created in 2025") === 'reimagine', 'reimagine: "tell me the story of ..."');
  check(mode("Improve the Kestrel's deck") === 'reimagine', 'reimagine: "improve the ... deck"');
  check(mode("We're pitching Kestrel's for a new headquarters. Their staff are burnt out and the board worries about cost.") === 'build', 'build: a new pitch to a client we already have a deck for');
  check(mode('A hospital group is merging three campuses. Staff are burnt out.') === 'build', 'build: a brief that names no deck');
  check(mode('Show me all proposals from 2025') === 'build', 'a whole year is a list for search, not one deck to open');
  const r = deckRequest("Kestrel's 2025", DECKS);
  check(r.mode === 'retrieve' && r.deck.id === 'kestrel-25', 'retrieve opens the deck from the year asked for');
  check(deckRequest('the hospital brief', DECKS, 'reimagine').mode === 'build', 'asking to retell needs a named deck');
  const merger = deckRequest("Kestrel's and Tailwind are merging. Help me figure out how to tell the story of that.", DECKS);
  check(merger.mode === 'build' && merger.context.length === 2, 'two clients merging is a new story, with both their decks as context', merger);
  const ours = deckRequest("Moser and Kestrel's are combining. Give me a story that tells me how we can prove that we're the right ones. I need an outline for the proposal.", DECKS);
  check(ours.mode === 'build' && ours.context.length === 1 && ours.context[0].clientName === "Kestrel's", '"prove we\'re the right ones ... an outline for the proposal" is a new story, never the old deck', ours);
  check(deckRequest("Tell me the story of Kestrel's", DECKS).mode === 'reimagine', 'the story of one deck is still a retelling');
}

if (failures) {
  console.error(`\n${failures} deck finder check(s) failed`);
  process.exit(1);
}
console.log('\nAll deck finder checks passed');
