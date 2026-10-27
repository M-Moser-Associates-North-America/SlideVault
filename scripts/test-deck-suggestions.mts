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
  const s = suggestFromRules({ fileName: 'M Moser_Gusto_SF_2026.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  check(s.client?.value === 'Gusto' && s.client.source === 'file name', "client from M Moser's file naming", s.client);
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
  const rules = suggestFromRules({ fileName: 'M Moser_Gusto_SF_2026.pptx', properties: NO_PROPS, slides: [], thisYear: THIS_YEAR });
  check(JSON.stringify(missingFacts(rules)) === JSON.stringify(['category', 'office']), 'the AI is asked only about what is missing', missingFacts(rules));
  const merged = mergeAiFacts(rules, { client: 'Someone Else', year: 1999, office: 'San Francisco', category: 'idd' }, { categories: ['IDD', 'SME'], thisYear: THIS_YEAR, model: 'qwen3:8b' });
  check(merged.client?.value === 'Gusto' && merged.year?.value === 2026, "the AI never replaces the rules' answers", merged);
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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll deck suggestion checks passed');
process.exit(failures ? 1 : 0);
