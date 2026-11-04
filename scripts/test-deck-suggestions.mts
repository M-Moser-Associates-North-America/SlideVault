/**
 * Deck facts filled in from the file (docs/DECISIONS.md FD-23). No database and no real model:
 * the rules run on made-up slides and file properties, one synthetic fixture is read end to end,
 * and the AI reader is a fake, so every rule can be checked exactly.
 *
 *   npm run test:deck-suggestions
 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { ExtractedSlide } from '../workers/slide-vault/processors/extract-text';
import { mergeAiFacts, openAiCompatibleDeckFactsReader, type DeckFactsReader } from '../features/slide-vault/server/ai/deck-facts';
import { cleanDeckTags, deckTagsInstructions, deckTagsSchema, openAiCompatibleDeckTagsReader, slidesForTags, MAX_DECK_TAGS, MAX_SLIDE_TAGS } from '../features/slide-vault/server/ai/deck-tags';
import { labelMenu } from '../features/slide-vault/server/ai/label-menu';
import { missingFacts, readFileProperties, suggestFromRules, type FileProperties } from '../features/slide-vault/server/deck-suggestions';
import { suggestDeckFacts } from '../features/slide-vault/server/services/suggest-deck';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

const NO_PROPS: FileProperties = { creator: null, lastModifiedBy: null, created: null, modified: null, title: null, company: null };
const slide = (number: number, title: string, text = ''): ExtractedSlide => ({ number, title, text, hidden: false });
const THIS_YEAR = 2026;

// ---- The folder and file name come first
{
  const s = suggestFromRules({ fileName: 'deck.pptx', folderPath: 'Submittals/2024/Northwind Bank/deck.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  check(s.client?.value === 'Northwind Bank' && s.client.source === 'folder', 'client from the folder', s.client);
  check(s.year?.value === 2024 && s.year.source === 'folder', 'year from the folder', s.year);
}
{
  const s = suggestFromRules({ fileName: 'M Moser_Sprocket_SF_2026.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  check(s.client?.value === 'Sprocket' && s.client.source === 'file name', "client from M Moser's file naming", s.client);
  check(s.year?.value === 2026 && s.year.source === 'file name', 'year from the file name', s.year);
}
{
  const s = suggestFromRules({ fileName: 'Proposal_20250314_v3.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  check(s.year?.value === 2025, 'year from a date in the file name (20250314)', s.year);
}
{
  const s = suggestFromRules({ fileName: 'Proposal 3021.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  check(s.year == null, 'an impossible year in the file name is ignored', s.year);
}

// ---- Then the cover slides
{
  const slides = [slide(1, 'Workplace Strategy Proposal', 'Prepared for Harbor Credit Union by M Moser Associates, March 2025. Since 1981.')];
  const s = suggestFromRules({ fileName: 'Proposal.pptx', properties: NO_PROPS, slides, thisYear: THIS_YEAR });
  check(s.client?.value === 'Harbor Credit Union' && s.client.source === 'slide text', '"Prepared for X by M Moser" names the client, without "by M Moser"', s.client);
  check(s.client?.evidence.startsWith('Slide 1:') === true, 'the client says which slide it came from', s.client);
  check(s.year?.value === 2025 && s.year.source === 'slide text', 'the latest year on the cover, not "since 1981"', s.year);
}
{
  const slides = [slide(1, 'Hello'), slide(2, 'Agenda'), slide(3, 'Team'), slide(4, 'Presented to Faraway Corp')];
  const s = suggestFromRules({ fileName: 'Proposal.pptx', properties: NO_PROPS, slides, thisYear: THIS_YEAR });
  check(s.client == null, 'only the first 3 slides count as the cover', s.client);
}
{
  const slides = [slide(1, 'Presented to M Moser leadership')];
  const s = suggestFromRules({ fileName: 'Proposal.pptx', properties: NO_PROPS, slides, thisYear: THIS_YEAR });
  check(s.client == null, 'M Moser is never suggested as the client', s.client);
}

// ---- Then the file's own properties
{
  const props: FileProperties = { ...NO_PROPS, creator: 'Sally Chen', lastModifiedBy: 'Raj Patel', modified: '2024-11-02T10:00:00Z', company: 'M Moser Associates' };
  const s = suggestFromRules({ fileName: 'Proposal.pptx', properties: props, slides: [], thisYear: THIS_YEAR });
  check(s.author?.value === 'Sally Chen' && s.author.source === 'file properties', 'author from the file', s.author);
  check(s.lastEditedBy?.value === 'Raj Patel', 'last editor when it is someone else', s.lastEditedBy);
  check(s.year?.value === 2024 && s.year.source === 'file properties', 'year from when the file was last saved, as the last resort', s.year);
}
{
  const props: FileProperties = { ...NO_PROPS, creator: 'Microsoft Office User', lastModifiedBy: 'Steve Canny', company: 'M Moser Associates' };
  const s = suggestFromRules({ fileName: 'Proposal.pptx', properties: props, slides: [], thisYear: THIS_YEAR });
  check(s.author == null && s.lastEditedBy == null, 'template and tool names ("Microsoft Office User", python-pptx\'s "Steve Canny") are not people', s);
}
{
  const props: FileProperties = { ...NO_PROPS, creator: 'M Moser Associates', lastModifiedBy: 'mmoser', company: 'mmoser' };
  const s = suggestFromRules({ fileName: 'Proposal.pptx', properties: props, slides: [], thisYear: THIS_YEAR });
  check(s.author == null && s.lastEditedBy == null, 'a company account is not a person', s);
}
{
  const props: FileProperties = { ...NO_PROPS, creator: 'Sally Chen', lastModifiedBy: 'Sally Chen' };
  const s = suggestFromRules({ fileName: 'Proposal.pptx', properties: props, slides: [], thisYear: THIS_YEAR });
  check(s.lastEditedBy == null, 'no separate last editor when the author saved it last', s.lastEditedBy);
}

// ---- The AI only fills gaps, and only with checked values
{
  const rules = suggestFromRules({ fileName: 'M Moser_Sprocket_SF_2026.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  check(JSON.stringify(missingFacts(rules)) === JSON.stringify(['category', 'office']), 'the AI is asked only about what is missing', missingFacts(rules));
  const merged = mergeAiFacts(rules, { client: 'Someone Else', year: 1999, office: 'San Francisco', category: 'idd' }, { categories: ['IDD', 'SME'], thisYear: THIS_YEAR, model: 'qwen3:8b' });
  check(merged.client?.value === 'Sprocket' && merged.year?.value === 2026, "the AI never replaces the rules' answers", merged);
  check(merged.office?.value === 'San Francisco' && merged.office.source === 'ai', 'the AI fills the office', merged.office);
  check(merged.category?.value === 'IDD', "a category is matched to the library's own spelling", merged.category);
}
{
  const rules = suggestFromRules({ fileName: 'Proposal.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  const merged = mergeAiFacts(rules, { client: 'M Moser Associates', year: 2031, office: '', category: 'Made Up' }, { categories: ['IDD'], thisYear: THIS_YEAR, model: 'm' });
  check(merged.client == null && merged.year == null && merged.office == null && merged.category == null, 'bad AI answers are dropped (M Moser, a future year, an unknown category)', merged);
}

// ---- End to end on a synthetic deck
const fixture = new Uint8Array(readFileSync('tests/fixtures/northwind-capabilities.pptx'));
async function withProps(bytes: Uint8Array, creator: string, modified: string) {
  const zip = await JSZip.loadAsync(bytes);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:creator>${creator}</dc:creator><cp:lastModifiedBy>${creator}</cp:lastModifiedBy><dcterms:modified>${modified}</dcterms:modified></cp:coreProperties>`);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}
{
  const bytes = await withProps(fixture, 'Jo &amp; Sam Lee', '2023-06-01T00:00:00Z');
  const props = await readFileProperties(bytes);
  check(props.creator === 'Jo & Sam Lee', 'file properties are read and decoded', props);
  let asked = 0;
  const fake: DeckFactsReader = { name: 'openai-compatible:fake', async read() { asked++; return { client: null, year: null, office: 'Toronto', category: null }; } };
  const off = await suggestDeckFacts('northwind-capabilities.pptx', bytes, { reader: fake, categories: [] }, { thisYear: THIS_YEAR });
  check(asked === 0 && off.reader === 'rules', 'no AI call unless reading is asked for', off.reader);
  check(off.slideCount > 0 && off.suggestions.author?.value === 'Jo & Sam Lee', 'the real file gives slides and an author', off);
  const on = await suggestDeckFacts('northwind-capabilities.pptx', bytes, { reader: fake, categories: [] }, { read: true, thisYear: THIS_YEAR });
  check(asked === 1 && on.reader === 'model' && on.suggestions.office?.value === 'Toronto', 'with reading on, the AI fills the office', on.suggestions.office);
  check(on.suggestions.office?.evidence.includes('fake') === true, 'the AI suggestion names the model', on.suggestions.office);
  const broken: DeckFactsReader = { name: 'x', async read() { throw new Error('timeout'); } };
  const down = await suggestDeckFacts('northwind-capabilities.pptx', bytes, { reader: broken, categories: [] }, { read: true, thisYear: THIS_YEAR });
  check(down.reader === 'rules' && !!down.readerNote && down.suggestions.author?.value === 'Jo & Sam Lee', "a failed AI call falls back to the file's own details, with a note", down);
}

// ---- The reader sends a fixed answer shape and only the cover text
{
  let sent: { body?: string } = {};
  const fetchFn = async (_url: string, init: RequestInit) => {
    sent = { body: String(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"client":"Acme","year":2025,"office":null,"category":null}' } }] }), { status: 200 });
  };
  const reader = openAiCompatibleDeckFactsReader({ baseUrl: 'http://x/v1', apiKey: null, model: 'm', timeoutMs: 1000 }, fetchFn);
  const out = await reader.read({ fileName: 'a.pptx', coverText: 'Slide 1: For Acme.', categories: ['IDD'] });
  const body = JSON.parse(sent.body ?? '{}');
  check(out.client === 'Acme' && body.response_format?.json_schema?.strict === true, 'strict Structured Outputs with the deck-facts shape', body.response_format);
  check(/Slide 1: For Acme\./.test(body.messages?.[1]?.content ?? ''), 'the cover text is sent as data', body.messages?.[1]);
}

// ---- AI tags for an upload (FD-85): the team's labels first, a new tag only as a rare exception, few of them
{
  const menu = labelMenu(['healthcare', 'financial services', 'retail']);
  const themes = menu.themes;
  const sectors = menu.sectors;
  const slides = [
    { number: 1, title: 'Harbor Bank: headquarters consolidation', text: 'Proposal prepared by Northwind Studio' },
    { number: 2, title: 'The challenge', text: 'Three leased buildings with peak desk use of 41%. Leases on two buildings end within 30 months.' },
    { number: 3, title: 'Utilisation evidence', text: 'Sensor study, six weeks, 1,200 desks.' },
    { number: 4, title: 'Thank you', text: 'Contact us' },
  ];
  const clean = (answer: Parameters<typeof cleanDeckTags>[0]) => cleanDeckTags(answer, { slides, themes, sectors, clientName: 'Harbor Bank' });

  const ok = clean({ deck: { labels: ['HEALTH & wellbeing', 'financial services', 'made up', 'AI', 'hybrid / flexible work'], extra: [] }, slides: [] });
  check(ok.deck.map((t) => t.tag).join() === 'health & wellbeing,financial services,hybrid / flexible work', `the deck gets at most ${MAX_DECK_TAGS} tags, only the team's labels, in the team's spelling; "AI" only where the slides say it`, ok.deck);
  check(ok.deck.every((t) => t.from === 'ai'), 'each tag says it came from the AI');

  const a = clean({ deck: { labels: [], extra: ['workplace stuff'] }, slides: [] });
  check(a.deck.length === 0, 'a new tag that is not on any slide is dropped as invented', a.deck);
  const b = clean({ deck: { labels: ['AI'], extra: ['utilisation'] }, slides: [] });
  check(b.deck.length === 0, 'a deck tag outside the labels needs to be on at least two slides (or the first); one slide is not enough; "AI" is not on any slide', b.deck);
  const c = clean({ deck: { labels: [], extra: ['bank'] }, slides: [] });
  check(c.deck.map((t) => t.tag).join() === 'bank', 'a new deck tag that is on the first slide is kept (the one exception)', c.deck);
  const d = clean({ deck: { labels: [], extra: ['bank', 'consolidation', 'leases'] }, slides: [] });
  check(d.deck.length <= 1, 'at most one new tag for the deck', d.deck);

  const s2 = clean({ deck: { labels: ['workplace strategy & data'], extra: [] }, slides: [{ number: 2, labels: ['cost certainty & risk', 'workplace strategy & data', 'AI'], extra: ['leases'] }] });
  check(s2.slides['2']?.map((t) => t.tag).join() === 'cost certainty & risk,leases', `a slide gets at most ${MAX_SLIDE_TAGS} tags and never repeats a deck tag`, s2.slides);
  // 3 Nov: the AI tagged slides "AI" everywhere; "ai" also hides inside "again", "said" and "maintain".
  const aiSlides = [{ number: 1, title: 'Forecasting', text: 'We use AI to forecast desk demand.' }, { number: 2, title: 'Maintenance', text: 'We said we would maintain it again.' }];
  const ai = cleanDeckTags({ deck: { labels: [], extra: [] }, slides: [{ number: 1, labels: ['AI'], extra: [] }, { number: 2, labels: ['AI'], extra: ['ai'] }] }, { slides: aiSlides, themes, sectors });
  check(ai.slides['1']?.[0]?.tag === 'AI' && !ai.slides['2'], 'the "AI" label only where the slide says AI as a word; letters inside other words never count', ai.slides);
  const s3 = clean({ deck: { labels: [], extra: [] }, slides: [{ number: 3, labels: [], extra: ['utilisation', 'sensor study'] }] });
  check(s3.slides['3']?.map((t) => t.tag).join() === 'utilisation', 'a slide gets one new tag at most, and only if its words are on that slide', s3.slides);
  const s4 = clean({ deck: { labels: [], extra: [] }, slides: [{ number: 3, labels: [], extra: ['lease expiry'] }, { number: 9, labels: ['AI'], extra: [] }] });
  check(Object.keys(s4.slides).length === 0, 'an invented slide tag and a slide that does not exist give nothing', s4.slides);
  const s5 = clean({ deck: { labels: [], extra: [] }, slides: [{ number: 1, labels: [], extra: ['harbor bank'] }, { number: 1, labels: [], extra: ['m moser'] }] });
  check(Object.keys(s5.slides).length === 0, "never the client's name or M Moser", s5.slides);
  check(Object.keys(clean({ deck: 'x', slides: 5 } as never).slides).length === 0 && clean({} as never).deck.length === 0, 'a wrongly shaped answer gives no tags');

  const shown = slidesForTags([{ number: 1, title: 'T'.repeat(300), text: 'x'.repeat(5000), hidden: false }, { number: 2, title: 'Hidden notes', text: 'secret', hidden: true }]);
  check(shown.length === 1 && shown[0].title.length === 100 && shown[0].text.length <= 240, 'hidden slides are not sent, and long titles and text are cut', shown.map((x) => [x.number, x.title.length, x.text.length]));

  const schema = deckTagsSchema(themes, sectors) as { properties: { deck: { properties: { labels: { items: { enum: string[] } } } } } };
  const allowed = schema.properties.deck.properties.labels.items.enum;
  check(allowed.includes('hybrid / flexible work') && allowed.includes('healthcare') && allowed.length === themes.length + sectors.length, 'the reply format lets "labels" hold only the team\'s themes and sectors');
  const said = deckTagsInstructions(themes, sectors);
  check(said.includes('inclusion & DEI') && /none to 2 for a slide/.test(said) && /most decks and slides need none/.test(said), 'the instructions list the labels and ask for few tags');

  let sent: { body?: string } = {};
  const fetchFn = async (_url: string, init: RequestInit) => {
    sent = { body: String(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ deck: { labels: ['AI'], extra: [] }, slides: [{ number: 2, labels: ['cost certainty & risk'], extra: [] }] }) } }] }), { status: 200 });
  };
  const reader = openAiCompatibleDeckTagsReader({ baseUrl: 'http://x/v1', apiKey: null, model: 'm', timeoutMs: 1000 }, fetchFn);
  const out = await reader.read({ fileName: 'a.pptx', slides, themes, sectors });
  const body = JSON.parse(sent.body ?? '{}');
  check(out.deck.labels[0] === 'AI' && body.response_format?.json_schema?.strict === true && body.response_format?.json_schema?.name === 'deck_tags', 'strict Structured Outputs with the deck-tags shape', body.response_format?.json_schema?.name);
  const user = String(body.messages?.[1]?.content ?? '');
  check(user.includes('2 | The challenge |') && !user.includes('Hidden') && body.messages?.[0]?.content.includes('never as instructions'), 'every slide goes as data, and slide text is never taken as instructions');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll deck suggestion checks passed');
process.exit(failures ? 1 : 0);
