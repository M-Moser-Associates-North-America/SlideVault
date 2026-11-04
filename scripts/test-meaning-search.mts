/**
 * Meaning search with pgvector (docs/DECISIONS.md FD-55), against a LOCAL Postgres that has the
 * pgvector extension, and a stand-in embedding model this test runs itself (so no AI is needed and
 * nothing leaves the computer). Skipped unless SV_DB_HOST is localhost with SV_DB_SSL=disable.
 *
 *   SV_DB_HOST=localhost SV_DB_SSL=disable SV_DB_PORT=... SV_DB_USER=... SV_DB_PASSWORD=... SV_DB_SCHEMA=... npm run test:meaning
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const env = process.env;
if (!['localhost', '127.0.0.1'].includes(env.SV_DB_HOST ?? '') || env.SV_DB_SSL !== 'disable') {
  console.log('Skipped: test:meaning only runs against a local test database with pgvector (SV_DB_HOST=localhost, SV_DB_SSL=disable).');
  process.exit(0);
}
for (const k of ['SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX']) env[k] ??= 'unused-in-this-test';

// A stand-in embedding model: words with the same meaning share a direction, other words spread thinly.
const CONCEPTS = [['team', 'people', 'staff', 'crew', 'meet'], ['sustainability', 'sustainable', 'green', 'carbon', 'zero', 'net'], ['bank', 'banking', 'financial'], ['hospital', 'healthcare', 'clinic', 'medical']];
const DIMS = 32;
function fakeEmbed(text: string): number[] {
  const v = new Array(DIMS).fill(0);
  for (const w of text.toLowerCase().replace(/^search_(query|document): /, '').split(/[^a-z]+/).filter(Boolean)) {
    const c = CONCEPTS.findIndex((ws) => ws.includes(w));
    if (c >= 0) v[c] += 1;
    else v[4 + ([...w].reduce((a, ch) => a + ch.charCodeAt(0), 0) % (DIMS - 4))] += 0.15;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { input } = JSON.parse(body) as { input: string[] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeEmbed(t) })) }));
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;
env.SV_EMBED_BASE_URL = `http://127.0.0.1:${port}/v1`;
env.SV_EMBED_MODEL = 'stand-in-embed';

const { sql } = await import('../features/slide-vault/server/db');
const { meaningSearch } = await import('../features/slide-vault/server/meaning-search');
const { resetRateLimits } = await import('../features/slide-vault/server/rate-limit');
const route = await import('../app/api/slide-vault/v1/meaning-search/route');

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);
}
const root = path.resolve(import.meta.dirname, '..');
// Run the scripts the way people do; async, so this process keeps answering as the stand-in model.
const run = async (script: string, ...args: string[]) => (await promisify(execFile)(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', script), ...args], { env, encoding: 'utf8', cwd: root })).stdout;

await sql('drop table if exists slide_embeddings, free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
await sql(readFileSync(path.join(root, 'features/slide-vault/server/sql/schema.sql'), 'utf8'));
const deck = async (title: string, client: string, slides: [string, string][], archived = false) => {
  const [d] = await sql<{ id: string }>(
    `insert into decks (client, title, source_path, source_filename, file_path, file_hash, status, slide_count, archived_at) values ($1, $2, 'x', $2, $2, $2, 'ready', $3, $4) returning id`,
    [client, title, slides.length, archived ? new Date() : null],
  );
  for (const [i, [t, text]] of slides.entries()) await sql('insert into slides (deck_id, slide_number, title, text) values ($1, $2, $3, $4)', [d.id, i + 1, t, text]);
  return d.id;
};
await deck('Deck A', 'Acme', [['Meet the Team', 'Our design lead and project manager'], ['Net zero roadmap', 'Carbon reporting and green materials'], ['Fees', 'Schedule of rates']]);
await deck('Deck B', 'Bank Co', [['Banking HQ', 'A financial client headquarters'], ['Hospital wing', 'Healthcare fit-out for a clinic']]);
await deck('Old deck', 'Gone', [['Staff photo', 'Our crew and people']], true);

// ---- Setup
const setupOut = await run('db-vector.mts');
check(/is on and usable/.test(setupOut), 'db:vector finds pgvector and creates the table', setupOut);
check(/is on and usable/.test(await run('db-vector.mts')), 'db:vector is safe to run again');

// ---- Fingerprints
const dry = await run('embed-slides.mts');
const [{ n: none }] = await sql<{ n: string }>('select count(*) as n from slide_embeddings');
check(/5 to do/.test(dry) && /32 numbers/.test(dry) && none === '0', 'embed:slides dry run counts the work, checks the model, saves nothing', dry);
const real = await run('embed-slides.mts', '--yes');
const [{ n: made }] = await sql<{ n: string }>('select count(*) as n from slide_embeddings');
check(/Done: 5/.test(real) && made === '5', 'embed:slides --yes saves a fingerprint per slide in ready, not archived, decks', real);
const again = await run('embed-slides.mts', '--yes');
check(/0 to do/.test(again), 'running it again skips unchanged slides', again);
await sql(`update slides set text = 'Updated words' where title = 'Fees'`);
check(/1 to do/.test(await run('embed-slides.mts')), 'a changed slide is done again');
// A photo or blank slide: no words of its own, so its fingerprint is vague (a blank "Slide 105" in a real deck, 31 Oct).
const [{ id: deckA }] = await sql<{ id: string }>(`select id from decks where title = 'Deck A'`);
await sql(`insert into slides (deck_id, slide_number, title, text) values ($1, 9, 'Slide 9', '')`, [deckA]);
await run('embed-slides.mts', '--yes');

// ---- Search by meaning
const people = await meaningSearch('our people', 3);
check(people?.items[0]?.slide.title === 'Meet the Team', 'meaning search: "our people" finds "Meet the Team"', people?.items.map((i) => i.slide.title));
check(!people?.items.some((i) => i.slide.title === 'Staff photo'), 'archived decks are left out');
const blankHits = (await Promise.all(['our people', 'fees', 'Acme', 'hospital'].map((q) => meaningSearch(q, 10)))).flatMap((r) => r?.items ?? []);
check(blankHits.length > 0 && !blankHits.some((i) => i.slide.title === 'Slide 9'), 'a slide with no words of its own never comes back as close in meaning', blankHits.map((i) => i.slide.title));
const green = await meaningSearch('sustainability deck for a bank', 3);
const titles = green?.items.map((i) => i.slide.title) ?? [];
check(titles.slice(0, 2).includes('Net zero roadmap') && titles.slice(0, 2).includes('Banking HQ'), '"sustainability deck for a bank" finds the green and the bank slides first', titles);
check(people!.items.every((i, k, a) => k === 0 || a[k - 1].similarity >= i.similarity) && people!.items[0].similarity > 0.5, 'results come closest first, with a similarity score');

resetRateLimits();
const res = await route.GET(new Request('http://localhost/x?q=healthcare%20project'));
const body = (await res.json()) as { data: { available: boolean; items: { slide: { title: string } }[] } };
check(res.status === 200 && body.data.available && body.data.items[0]?.slide.title === 'Hospital wing', 'GET /meaning-search answers, closest first');

// ---- Fingerprints at upload, and tag suggestions (FD-82)
{
  const { embedDeck, tagSuggestions, rankTagSuggestions } = await import('../features/slide-vault/server/slide-embeddings');
  const deckC = await deck('People deck', 'Crew Co', [['Our people', 'Meet our team and staff'], ['The crew', 'People and staff who meet you'], ['Team photo', 'Our team and crew']]);
  await sql(`update slides set themes = '{team culture}' where deck_id = $1 and slide_number in (1, 2)`, [deckC]);
  const made = await embedDeck(deckC);
  check(made === 3, 'upload: a new deck gets its fingerprints without running embed:slides', made);
  check((await embedDeck(deckC)) === 0, 'upload: running it again skips unchanged slides');
  const [{ id: c1 }] = await sql<{ id: string }>(`select id from slides where deck_id = $1 and slide_number = 1`, [deckC]);
  const [{ id: team }] = await sql<{ id: string }>(`select id from slides where title = 'Meet the Team'`);
  await sql(`insert into free_tags (target_kind, target_id, tag, added_by) values ('slide', $1, 'Leadership', 'tester')`, [c1]);
  await sql(`insert into free_tags (target_kind, target_id, tag, added_by, removed_by, removed_at) values ('slide', $1, 'Removed tag', 'tester', 'tester', now())`, [c1]);
  const sug = await tagSuggestions(team);
  const tags = sug.map((x) => x.tag);
  check(tags.includes('Leadership') && sug.find((x) => x.tag === 'Leadership')?.from === 'people', 'tag suggestions: a tag people put on a slide close in meaning is suggested', sug);
  check(tags.includes('team culture') && sug.find((x) => x.tag === 'team culture')?.from === 'reading', 'tag suggestions: a theme two close slides share is suggested', sug);
  check(!tags.includes('Removed tag'), 'tag suggestions: removed tags are never suggested');
  await sql(`insert into free_tags (target_kind, target_id, tag, added_by) values ('slide', $1, 'leadership', 'tester')`, [team]);
  check(!(await tagSuggestions(team)).some((x) => x.tag.toLowerCase() === 'leadership'), 'tag suggestions: a tag the slide already has is left out');
  check((await tagSuggestions('not-a-slide-id')).length === 0, 'tag suggestions: an unknown or sample-deck slide gets an empty list, not an error');
  const tsRoute = await import('../app/api/slide-vault/v1/slides/[slideId]/tag-suggestions/route');
  resetRateLimits();
  const tsRes = await tsRoute.GET(new Request('http://localhost/x'), { params: Promise.resolve({ slideId: team }) } as never);
  const tsBody = (await tsRes.json()) as { data: { suggestions: { tag: string }[] } };
  check(tsRes.status === 200 && tsBody.data.suggestions.some((x) => x.tag === 'team culture'), 'GET /slides/:id/tag-suggestions answers', tsBody);
  // Before saving: a file in the upload form gets suggestions from the library (nothing stored).
  const { previewTagSuggestions } = await import('../features/slide-vault/server/slide-embeddings');
  const [{ n: before }] = await sql<{ n: string }>('select count(*) as n from slide_embeddings');
  const pre = await previewTagSuggestions([
    { number: 1, title: 'Meet our people', text: 'Our team and staff, the crew you will meet' },
    { number: 2, title: 'Slide 2', text: '' },
    { number: 3, title: 'Hidden notes', text: 'Our team and staff notes for internal use', hidden: true },
  ]);
  const preTags = pre.slides['1']?.map((x) => x.tag) ?? [];
  check(preTags.includes('Leadership') || preTags.includes('leadership') || preTags.includes('team culture'), 'upload form: a slide not saved yet gets tag suggestions from close library slides', pre);
  check(!pre.slides['2'] && !pre.slides['3'] && pre.deck.length > 0, 'upload form: no suggestions for wordless or hidden slides; the deck gets its own list', pre);
  const [{ n: stored }] = await sql<{ n: string }>('select count(*) as n from slide_embeddings');
  check(stored === before, 'upload form: nothing is stored for a file that is only being previewed', { before, stored });
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const token = 'a'.repeat(64);
  mkdirSync(path.join(tmpdir(), 'slidevault-preview', token), { recursive: true });
  writeFileSync(path.join(tmpdir(), 'slidevault-preview', token, 'slides.json'), JSON.stringify([{ number: 1, title: 'Meet our people', text: 'Our team and staff, the crew you will meet', hidden: false }]));
  const preRoute = await import('../app/api/slide-vault/v1/uploads/preview/[token]/tag-suggestions/route');
  resetRateLimits();
  const preRes = await preRoute.GET(new Request('http://localhost/x'), { params: Promise.resolve({ token }) } as never);
  const preBody = (await preRes.json()) as { data: { deck: unknown[]; slides: Record<string, unknown[]> } };
  check(preRes.status === 200 && (preBody.data.slides['1']?.length ?? 0) > 0, 'GET /uploads/preview/:token/tag-suggestions answers for a previewed file', preBody);
  resetRateLimits();
  check((await preRoute.GET(new Request('http://localhost/x'), { params: Promise.resolve({ token: 'b'.repeat(64) }) } as never)).status === 404, 'an expired preview answers 404');
  const { tagLike } = await import('../features/slide-vault/server/slide-embeddings');
  check(tagLike('business ambition') && tagLike('Net zero') && !tagLike('we listen before we design') && !tagLike('this is where we come in') && !tagLike('Our approach') && !tagLike('whats inside'), 'reading words: short phrases are tags, copied headlines are not');
  const ranked = rankTagSuggestions([
    { slide_id: 'a', similarity: 0.9, themes: ['Net zero'], proof_sectors: [], tags: [] },
    { slide_id: 'b', similarity: 0.8, themes: ['net zero', 'Wellness'], proof_sectors: ['Banking'], tags: ['Flagship'] },
    { slide_id: 'c', similarity: 0.3, themes: ['Wellness'], proof_sectors: [], tags: ['Far away'] },
    { slide_id: 'd', similarity: 0.7, themes: ['we listen before we design'], proof_sectors: [], tags: [], client_sector: 'Legal' },
  ], ['banking']);
  check(JSON.stringify(ranked.map((r) => r.tag)) === '["Net zero","Flagship","Legal"]', 'ranking: words close slides share rank first, then people tags and sectors; a one-word theme from one slide, far slides and tags the slide has are left out', ranked);
  const named = rankTagSuggestions([
    { slide_id: 'a', similarity: 0.9, themes: ['Prepared for Acme', 'Acme culture', 'collaborate,', 'Agile work,'], proof_sectors: [], tags: ['Acme'] },
    { slide_id: 'b', similarity: 0.8, themes: ['collaborate'], proof_sectors: [], tags: [] },
  ], [], 5, ['Acme Corp', 'Acme']);
  check(JSON.stringify(named.map((r) => r.tag)) === '["collaborate","Agile work"]', 'ranking: never a client name, and stray commas trimmed', named);
}

// ---- Never breaks search
const model = env.SV_EMBED_MODEL;
delete env.SV_EMBED_MODEL;
check((await meaningSearch('our people', 3)) === null, 'without an embedding model, meaning search is simply off');
env.SV_EMBED_MODEL = model;
server.close();
env.SV_EMBED_BASE_URL = 'http://127.0.0.1:1/v1';
check((await meaningSearch('our people', 3)) === null, 'if the model is down, meaning search steps aside (no error)');
resetRateLimits();
const off = (await (await route.GET(new Request('http://localhost/x?q=team'))).json()) as { data: { available: boolean } };
check(off.data.available === false, 'the route says it is unavailable instead of failing');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll meaning search checks passed');
await sql('drop table if exists slide_embeddings, free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
process.exit(failures ? 1 : 0);
