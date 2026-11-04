/**
 * Story tags and free-form tags on slides (docs/DECISIONS.md FD-53), against a LOCAL test database.
 * It writes and deletes rows, so it only runs against a database on this computer with SSL off:
 *
 *   SV_DB_HOST=localhost SV_DB_SSL=disable SV_DB_PORT=... SV_DB_USER=... SV_DB_PASSWORD=... SV_DB_SCHEMA=... npm run test:tags
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
if (!['localhost', '127.0.0.1'].includes(env.SV_DB_HOST ?? '') || env.SV_DB_SSL !== 'disable') {
  console.log('Skipped: test:tags only runs against a local test database (SV_DB_HOST=localhost, SV_DB_SSL=disable).');
  process.exit(0);
}
for (const k of ['SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX']) env[k] ??= 'unused-in-this-test';

const { sql } = await import('../features/slide-vault/server/db');
const { getSlidePg, searchSlidesPg, isInternalOnly } = await import('../features/slide-vault/server/pg-repository');
const { tagsInQuery, withTags } = await import('../features/slide-vault/server/tags');
const { resetRateLimits } = await import('../features/slide-vault/server/rate-limit');
const tagsRoute = await import('../app/api/slide-vault/v1/tags/route');
const tagRoute = await import('../app/api/slide-vault/v1/tags/[tagId]/route');
const restoreRoute = await import('../app/api/slide-vault/v1/tags/[tagId]/restore/route');
const removedRoute = await import('../app/api/slide-vault/v1/tags/removed/route');
const slideRoute = await import('../app/api/slide-vault/v1/slides/[slideId]/route');

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);
}
const call = async (fn: (r: Request, c: never) => Promise<Response>, method: string, body?: unknown, params: Record<string, string> = {}, user: string | null = 'Pat Doe') => {
  resetRateLimits();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) headers['x-slidevault-user'] = encodeURIComponent(user);
  const res = await fn(new Request('http://localhost/x', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) } as never);
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown> & unknown[]; error?: { code: string } } };
};

await sql('drop table if exists free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
const schema = readFileSync(path.resolve(import.meta.dirname, '../features/slide-vault/server/sql/schema.sql'), 'utf8');
await sql(schema);
const [d] = await sql<{ id: string }>(`insert into decks (client, title, source_path, source_filename, file_path, file_hash, status, slide_count) values ('Acme', 'Deck', 'x', 'Deck', 'p', 'h', 'ready', 3) returning id`);
const [d2] = await sql<{ id: string }>(`insert into decks (client, title, source_path, source_filename, file_path, file_hash, status, slide_count) values ('Beta', 'Other', 'x', 'Other', 'p2', 'h2', 'ready', 1) returning id`);
await sql(`insert into slides (deck_id, slide_number, title, text) select $1, g, 'Slide ' || g, 'words ' || g from generate_series(1, 3) g`, [d.id]);
await sql(`insert into slides (deck_id, slide_number, title, text) values ($1, 1, 'Other 1', 'words')`, [d2.id]);
const ids = (await sql<{ id: string }>('select id from slides where deck_id = $1 order by slide_number', [d.id])).map((r) => r.id);
const [other] = await sql<{ id: string }>('select id from slides where deck_id = $1', [d2.id]);

// ---- Story tags reach the app
await sql(`update slides set story_role = 'proof', slide_type = 'case_study_detail', reuse_status = 'reusable', themes = '{wellbeing}', proof_sectors = '{healthcare}', projects = '{Some HQ}', flags = '{}', story_status = 'confirmed' where id = $1`, [ids[0]]);
await sql(`update slides set story_role = 'why us', shows = 'Team photo', convinces = 'We are friendly', story_status = 'suggested', ai_uncertain = true where id = $1`, [ids[1]]);
await sql(`update slides set story_role = 'admin', reuse_status = 'internal - never show', story_status = 'confirmed' where id = $1`, [ids[2]]);
const listed = await searchSlidesPg('', 100);
const byId = new Map(listed.map((s) => [s.id, s]));
const s0 = byId.get(ids[0])!.story;
check(s0?.role === 'proof' && s0.status === 'confirmed' && s0.themes[0] === 'wellbeing' && s0.sectors[0] === 'healthcare' && s0.projects[0] === 'Some HQ' && !s0.uncertain, 'a reviewed slide carries its story tags, confirmed');
const s1 = byId.get(ids[1])!.story;
check(s1?.status === 'suggested' && s1.uncertain && s1.shows === 'Team photo' && s1.convinces === 'We are friendly', "an AI-only slide is suggested, with the AI's doubt and reading");
check(byId.get(other.id)!.story === undefined, 'a slide nobody tagged carries no story');
check(isInternalOnly(byId.get(ids[2])!) && !isInternalOnly(byId.get(ids[0])!), '"internal - never show" slides are recognised');

// ---- Free tags
const t1 = await call(tagsRoute.POST, 'POST', { on: 'slide', id: ids[0], tag: '  Hospital   wing ' });
check(t1.status === 200 && t1.json.data?.tag === 'Hospital wing' && t1.json.data?.on === 'slide' && t1.json.data?.addedBy === 'Pat Doe', 'POST /tags tags a slide (spaces tidied, who recorded)', t1);
const again = await call(tagsRoute.POST, 'POST', { on: 'slide', id: ids[0], tag: 'hospital WING' });
check(again.status === 200 && again.json.data?.id === t1.json.data?.id, 'the same tag again (any capitals) returns the existing one');
const t2 = await call(tagsRoute.POST, 'POST', { on: 'deck', id: d.id, tag: 'Healthcare' });
check(t2.status === 200 && t2.json.data?.on === 'deck', 'POST /tags tags a whole deck');
check((await call(tagsRoute.POST, 'POST', { on: 'page', id: ids[0], tag: 'x' })).status === 400, 'on must be slide or deck');
check((await call(tagsRoute.POST, 'POST', { on: 'slide', id: ids[0], tag: 'x'.repeat(61) })).status === 400, 'a tag is at most 60 characters');
check((await call(tagsRoute.POST, 'POST', { on: 'slide', id: ids[0], tag: '   ' })).status === 400, 'an empty tag is refused');
check((await call(tagsRoute.POST, 'POST', { on: 'slide', id: crypto.randomUUID(), tag: 'x' })).status === 404, 'tagging a slide that does not exist is a 404');
check((await call(tagsRoute.POST, 'POST', { on: 'slide', id: ids[0], tag: 'x' }, {}, null)).json.error?.code === 'SIGNED_OUT', 'signed out cannot tag');

const tagged = await withTags(await searchSlidesPg('', 100));
const tg = new Map(tagged.map((s) => [s.id, s.tags?.map((t) => t.tag) ?? []]));
check(JSON.stringify(tg.get(ids[0])) === JSON.stringify(['Hospital wing', 'Healthcare']), "a slide shows its own tags, then its deck's", tg.get(ids[0]));
check(JSON.stringify(tg.get(ids[1])) === JSON.stringify(['Healthcare']), "every slide in the deck shows the deck's tag");
check((tg.get(other.id) ?? []).length === 0, 'slides in other decks get none');

const filtered = await searchSlidesPg('', 100, 'exclude', 'healthcare');
check(filtered.length === 3 && filtered.every((s) => s.provenance.sourceId === d.id), 'search tag= finds slides through their deck tag');
check((await searchSlidesPg('', 100, 'exclude', 'Hospital Wing')).length === 1, 'search tag= finds a slide tag, any capitals');

const list = await call(tagsRoute.GET, 'GET');
const rows = list.json.data as unknown as { tag: string; slides: number; decks: number }[];
check(rows.length === 2 && rows.some((r) => r.tag === 'Healthcare' && r.decks === 1) && rows.some((r) => r.tag === 'Hospital wing' && r.slides === 1), 'GET /tags lists every tag with how often it is used', rows);

const del = await call(tagRoute.DELETE, 'DELETE', undefined, { tagId: String(t1.json.data?.id) });
check(del.status === 200 && (await withTags(await searchSlidesPg('', 100))).find((s) => s.id === ids[0])!.tags?.length === 1, 'DELETE /tags/:id removes it');
check((await call(tagRoute.DELETE, 'DELETE', undefined, { tagId: String(t1.json.data?.id) })).status === 404, 'removing it again is a 404');
check((await call(tagRoute.DELETE, 'DELETE', undefined, { tagId: "1; drop table slides" })).status === 404, 'a malformed tag id is a 404, nothing run');

// ---- Removed tags are kept, listed and can come back (FD-72, 1 Nov)
const hospitalId = String(t1.json.data?.id);
const removed = async (on: string, id: string, user: string | null = 'Sam Lee') => {
  resetRateLimits();
  const res = await removedRoute.GET(new Request(`http://localhost/x?${new URLSearchParams({ on, id })}`, { headers: user ? { 'x-slidevault-user': encodeURIComponent(user) } : {} }));
  return { status: res.status, json: (await res.json()) as { data?: { id: string; tag: string; on: string; addedBy: string; removedBy: string; removedAt: string }[]; error?: { code: string } } };
};
const log1 = await removed('slide', ids[0]);
check(log1.status === 200 && log1.json.data?.length === 1 && log1.json.data[0].tag === 'Hospital wing' && log1.json.data[0].addedBy === 'Pat Doe' && log1.json.data[0].removedBy === 'Pat Doe' && !!log1.json.data[0].removedAt, 'GET /tags/removed lists a removed tag with who added and who removed it', log1);
check(!(await call(tagsRoute.GET, 'GET')).json.data?.some((r) => (r as { tag: string }).tag === 'Hospital wing'), 'a removed tag drops out of the tag list');
check((await searchSlidesPg('', 100, 'exclude', 'Hospital Wing')).length === 0, 'and out of search by tag');
check(!(await tagsInQuery('hospital wing slides')).length, "and doesn't lead searches");
const back = await call(restoreRoute.POST, 'POST', undefined, { tagId: hospitalId }, 'Sam Lee');
check(back.status === 200 && back.json.data?.tag === 'Hospital wing' && back.json.data?.addedBy === 'Pat Doe', 'POST /tags/:id/restore brings it back with its original adder', back);
check((await withTags(await searchSlidesPg('', 100))).find((s) => s.id === ids[0])!.tags?.length === 2 && (await removed('slide', ids[0])).json.data?.length === 0, 'restored: on the slide again and off the removed list');
check((await call(restoreRoute.POST, 'POST', undefined, { tagId: hospitalId })).status === 404, 'restoring a tag that is not removed is a 404');
await call(tagRoute.DELETE, 'DELETE', undefined, { tagId: hospitalId }, 'Sam Lee');
const readd = await call(tagsRoute.POST, 'POST', { on: 'slide', id: ids[0], tag: 'hospital WING' }, {}, 'Kim Ray');
check(readd.status === 200 && readd.json.data?.id === hospitalId && readd.json.data?.addedBy === 'Pat Doe' && (await removed('slide', ids[0])).json.data?.length === 0, 'adding a removed tag again brings the same one back, not a copy');
check((await removed('page', ids[0])).status === 400 && (await removed('slide', 'not-an-id')).status === 400, 'the removed list needs a slide or deck id');
check((await call(restoreRoute.POST, 'POST', undefined, { tagId: hospitalId }, null)).json.error?.code === 'SIGNED_OUT' && (await removed('slide', ids[0], null)).json.error?.code === 'SIGNED_OUT', 'signed out cannot restore or see the log');

// ---- Renaming a slide for everyone (FD-73, 1 Nov)
const before = (await getSlidePg(ids[0]))!.summary.title;
const ren = await call(slideRoute.PATCH, 'PATCH', { title: '  Our   hospital work ' }, { slideId: ids[0] });
const renamed = (await getSlidePg(ids[0]))!.summary;
check(ren.status === 200 && ren.json.data?.title === 'Our hospital work' && renamed.title === 'Our hospital work', 'PATCH /slides/:id renames the slide (spaces tidied)', ren);
check(renamed.titleEdit?.kind === 'person' && renamed.titleEdit.by === 'Pat Doe' && !!renamed.titleEdit.at, 'the slide says who renamed it and when', renamed.titleEdit);
check((await searchSlidesPg('hospital work', 10)).some((x) => x.id === ids[0]), 'search finds the new name');
await call(slideRoute.PATCH, 'PATCH', { title: 'Hospital projects' }, { slideId: ids[0] }, 'Kim Ray');
check((await getSlidePg(ids[0]))!.summary.titleEdit?.by === 'Kim Ray', 'a second rename records the new person');
const reset = await call(slideRoute.PATCH, 'PATCH', { title: null }, { slideId: ids[0] });
const original = (await getSlidePg(ids[0]))!.summary;
check(reset.status === 200 && original.title === before && original.titleEdit === undefined, '{ title: null } puts back the title read from the slide, not the first rename', { before, after: original.title });
check((await call(slideRoute.PATCH, 'PATCH', { title: '   ' }, { slideId: ids[0] })).status === 400 && (await call(slideRoute.PATCH, 'PATCH', { title: 'x'.repeat(201) }, { slideId: ids[0] })).status === 400 && (await call(slideRoute.PATCH, 'PATCH', { name: 'x' }, { slideId: ids[0] })).status === 400, 'an empty, too long or missing name is refused');
check((await call(slideRoute.PATCH, 'PATCH', { title: 'x' }, { slideId: crypto.randomUUID() })).status === 404 && (await call(slideRoute.PATCH, 'PATCH', { title: 'x' }, { slideId: 'sld_fixture' })).status === 404, 'only slides in the database can be renamed');
check((await call(slideRoute.PATCH, 'PATCH', { title: 'x' }, { slideId: ids[0] }, null)).json.error?.code === 'SIGNED_OUT', 'signed out cannot rename');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll tag checks passed');
await sql('drop table if exists free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
process.exit(failures ? 1 : 0);
