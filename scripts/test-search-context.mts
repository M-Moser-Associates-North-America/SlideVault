/**
 * Search that understands more than words (docs/DECISIONS.md FD-56), against a LOCAL test database.
 * Gaby's cases from the 28 Oct check-in: "hospitality" should find hospitality slides before a slide
 * that only says the word, "2026" is a year, "banner" is a kind of slide, a tag like "Moira" is
 * searchable, and "not relevant" pushes a slide down for that search.
 *
 *   SV_DB_HOST=localhost SV_DB_SSL=disable SV_DB_PORT=... SV_DB_USER=... SV_DB_PASSWORD=... SV_DB_SCHEMA=... npm run test:search-context
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
if (!['localhost', '127.0.0.1'].includes(env.SV_DB_HOST ?? '') || env.SV_DB_SSL !== 'disable') {
  console.log('Skipped: test:search-context only runs against a local test database (SV_DB_HOST=localhost, SV_DB_SSL=disable).');
  process.exit(0);
}
for (const k of ['SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX']) env[k] ??= 'unused-in-this-test';
delete env.SV_EMBED_MODEL;
env.SV_AI_PROVIDER = 'none';
env.SLIDEVAULT_DATA_DIR = path.resolve(import.meta.dirname, '../.nonexistent-test-data');

const { sql } = await import('../features/slide-vault/server/db');
const { smartSearchPg } = await import('../features/slide-vault/server/pg-repository');
const { standInPlan, groundFilters } = await import('../features/slide-vault/server/ai/search-plan');
const { searchIntent } = await import('../features/slide-vault/server/services/slide-intent');
const { resetRateLimits } = await import('../features/slide-vault/server/rate-limit');
const smartRoute = await import('../app/api/slide-vault/v1/smart-search/route');
const feedbackRoute = await import('../app/api/slide-vault/v1/search-feedback/route');

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);
}

await sql('drop table if exists search_feedback, free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
await sql(readFileSync(path.resolve(import.meta.dirname, '../features/slide-vault/server/sql/schema.sql'), 'utf8'));
type S = { title: string; text: string; type?: string; themes?: string[]; sectors?: string[]; reuse?: string };
const deck = async (client: string, year: number, sector: string | null, slides: S[]) => {
  const [d] = await sql<{ id: string }>(
    `insert into decks (client, title, source_path, source_filename, file_path, file_hash, status, slide_count, year, client_sector) values ($1, $1 || ' deck', 'x', $1, $1, $1, 'ready', $2, $3, $4) returning id`,
    [client, slides.length, year, sector],
  );
  for (const [i, s] of slides.entries()) {
    await sql(
      `insert into slides (deck_id, slide_number, title, text, slide_type, themes, proof_sectors, reuse_status, story_status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [d.id, i + 1, s.title, s.text, s.type ?? null, s.themes ?? [], s.sectors ?? [], s.reuse ?? null, s.type ? 'confirmed' : null],
    );
  }
  return d.id;
};
await deck('Acme Hotels', 2025, 'hospitality', [
  { title: 'Guest lounge and amenities', text: 'A lobby lounge with a coffee bar', type: 'case_study_detail', themes: ['amenities & hospitality'] },
  { title: 'Our approach', text: 'Discovery and design', type: 'approach_process' },
  { title: 'Section two', text: 'Two', type: 'section_divider' },
]);
const B = await deck('Beta Health', 2026, 'healthcare / medtech', [
  { title: 'Interview with a director', text: 'She talks about hospitality in her career and her favourite projects', type: 'differentiator' },
  { title: 'Meet the project team', text: 'Design lead and project manager', type: 'team_structure', sectors: ['healthcare / life sciences'] },
  { title: 'Internal checklist', text: 'Do not send. Team hospitality notes', type: 'legal_admin', reuse: 'internal - never show' },
  { title: 'Thank you', text: 'Contact us', type: 'closing' },
]);
await deck('Gamma Bank', 2024, 'financial services', [{ title: 'Team', text: 'Our people for this bank', type: 'team_structure' }]);

const search = async (q: string) => {
  const ctx = { clients: ['Acme Hotels', 'Beta Health', 'Gamma Bank'], categories: [], thisYear: 2026 };
  return (await smartSearchPg(groundFilters(standInPlan(q, ctx), q), 20, searchIntent(q))).map((r) => r.summary.title);
};

const hosp = await search('hospitality');
check(hosp[0] === 'Guest lounge and amenities', '"hospitality": a hospitality slide comes before one that only says the word', hosp);
check(hosp.indexOf('Internal checklist') === hosp.length - 1, '"hospitality": an internal-only slide stays findable, but last', hosp);
const team = await search('team slide for a healthcare client');
check(team[0] === 'Meet the project team', '"team slide for a healthcare client": the healthcare team slide is first', team);
const banner = await search('banner');
check(banner.length === 1 && banner[0] === 'Section two', '"banner" finds section banners even without the word', banner);
check((await search('ending slide'))[0] === 'Thank you', '"ending slide" finds the closing slide');
const y = await search('2026');
check(y.length === 4 && !y.includes('Team') && !y.includes('Our approach'), '"2026" is a year: only slides from 2026 decks', y);
await sql(`insert into free_tags (target_kind, target_id, tag, added_by) values ('deck', $1, 'Moira', 'Pat')`, [B]);
const moira = await search('Moira');
check(moira.length === 4 && moira.includes('Meet the project team'), 'a free tag ("Moira") on a deck makes its slides findable by it', moira);

// ---- The route: "why it fits" and "not relevant"
resetRateLimits();
const get = async (q: string) => (await (await smartRoute.GET(new Request(`http://localhost/x?q=${encodeURIComponent(q)}`))).json()) as { data: { items: { slide: { id: string; title: string }; why: string }[] } };
const r1 = await get('hospitality');
check(r1.data.items[0]?.slide.title === 'Guest lounge and amenities' && /hospitality/i.test(r1.data.items[0].why), 'GET /smart-search puts it first and says why', r1.data.items[0]);
check(!r1.data.items.some((i) => i.slide.title === 'Internal checklist'), 'internal-only slides are left out of the app\'s results unless hidden=include');
const first = r1.data.items[0].slide;
const mark = async (body: unknown, user: string | null = 'Pat') => {
  resetRateLimits();
  return feedbackRoute.POST(new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { 'x-slidevault-user': user } : {}) }, body: JSON.stringify(body) }));
};
check((await mark({ query: 'Hospitality!', slideId: first.id, notRelevant: true })).status === 200, 'POST /search-feedback marks a result not relevant');
const [row] = await sql<{ query_key: string }>('select query_key from search_feedback');
check(row.query_key === 'hospitality', 'only the search words are stored, not who said it', row);
resetRateLimits();
const r2 = await get('hospitality');
check(r2.data.items.at(-1)?.slide.id === first.id && r2.data.items.length === r1.data.items.length, 'that slide moves to the end of that search, and nothing is hidden', r2.data.items.map((i) => i.slide.title));
resetRateLimits();
const other = await get('lounge');
check(other.data.items[0]?.slide.id === first.id, 'other searches are not affected');
await mark({ query: 'hospitality', slideId: first.id, notRelevant: false });
resetRateLimits();
check((await get('hospitality')).data.items[0]?.slide.id === first.id, 'notRelevant: false undoes it');
check((await mark({ query: '', slideId: first.id, notRelevant: true })).status === 400, 'an empty search is refused');
check((await mark({ query: 'x y', slideId: 'nope', notRelevant: true })).status === 400, 'a sample-deck or bad slide id is refused');
check((await mark({ query: 'hospitality', slideId: first.id, notRelevant: true }, null)).status === 400, 'signed out cannot mark');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll search-in-context checks passed');
await sql('drop table if exists search_feedback, free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
process.exit(failures ? 1 : 0);
