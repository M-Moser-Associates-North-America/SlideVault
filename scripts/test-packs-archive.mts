/**
 * Slide packs, archive and deck details from the server (docs/DECISIONS.md FD-52), against a LOCAL
 * test database. It writes and deletes rows, so it refuses to run against anything but a database on
 * this computer with SSL off, never M Moser's project:
 *
 *   SV_DB_HOST=localhost SV_DB_SSL=disable SV_DB_PORT=... SV_DB_USER=... SV_DB_PASSWORD=... SV_DB_SCHEMA=... npm run test:packs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
if (!['localhost', '127.0.0.1'].includes(env.SV_DB_HOST ?? '') || env.SV_DB_SSL !== 'disable') {
  console.log('Skipped: test:packs only runs against a local test database (SV_DB_HOST=localhost, SV_DB_SSL=disable).');
  process.exit(0);
}
for (const k of ['SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX']) env[k] ??= 'unused-in-this-test';

const { sql } = await import('../features/slide-vault/server/db');
const { searchSlidesPg } = await import('../features/slide-vault/server/pg-repository');
const { withPacks } = await import('../features/slide-vault/server/packs');
const { readCoreXml } = await import('../features/slide-vault/server/file-facts');
const { resetRateLimits } = await import('../features/slide-vault/server/rate-limit');
const packsRoute = await import('../app/api/slide-vault/v1/packs/route');
const packRoute = await import('../app/api/slide-vault/v1/packs/[packId]/route');
const deckRoute = await import('../app/api/slide-vault/v1/decks/[deckId]/route');

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
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown> & { slideIds?: string[] }; error?: { code: string; message: string } } };
};

// Fresh tables, then the schema twice to prove it's safe to rerun.
await sql('drop table if exists free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
const schema = readFileSync(path.resolve(import.meta.dirname, '../features/slide-vault/server/sql/schema.sql'), 'utf8');
await sql(schema);
await sql(schema);
check(true, 'schema.sql runs twice without errors');

const deck = async (title: string, n: number) => {
  const [d] = await sql<{ id: string }>(
    `insert into decks (client, title, source_path, source_filename, file_path, file_hash, status, slide_count) values ('Acme', $1, 'x', $1, $2, $3, 'ready', $4) returning id`,
    [title, `p/${title}`, `hash-${title}`, n],
  );
  await sql(`insert into slides (deck_id, slide_number, title, text) select $1, g, 'Slide ' || g, 'words ' || g from generate_series(1, $2) g`, [d.id, n]);
  const s = await sql<{ id: string }>('select id from slides where deck_id = $1 order by slide_number', [d.id]);
  return { id: d.id, slides: s.map((r) => r.id) };
};
const A = await deck('Deck A', 6);
const B = await deck('Deck B', 3);

// ---- Making a pack
const made = await call(packsRoute.POST, 'POST', { slideIds: [A.slides[2], A.slides[0], A.slides[1]], label: '  Our process  ' });
check(made.status === 200 && made.json.data?.status === 'confirmed' && made.json.data?.confirmedBy === 'Pat Doe' && made.json.data?.label === 'Our process', 'POST /packs: a person-made pack is confirmed, by them, label trimmed', made);
check(JSON.stringify(made.json.data?.slideIds) === JSON.stringify([A.slides[2], A.slides[0], A.slides[1]]), 'POST /packs: keeps the order it was given');
const packId = String(made.json.data?.id);

const clash = await call(packsRoute.POST, 'POST', { slideIds: [A.slides[1], A.slides[3]], label: null });
check(clash.status === 409 && /slide 2/.test(clash.json.error?.message ?? ''), '409 when a slide is already in a pack, naming the slide', clash);
check((await call(packsRoute.POST, 'POST', { slideIds: [A.slides[4], B.slides[0]], label: null })).status === 400, '400 when slides come from different decks');
check((await call(packsRoute.POST, 'POST', { slideIds: [A.slides[4]], label: null })).status === 400, '400 for a one-slide pack');
check((await call(packsRoute.POST, 'POST', { slideIds: [A.slides[4], A.slides[4]], label: null })).status === 400, '400 when a slide is listed twice');
check((await call(packsRoute.POST, 'POST', { slideIds: Array.from({ length: 21 }, () => crypto.randomUUID()), label: null })).status === 400, '400 for more than 20 slides');
check((await call(packsRoute.POST, 'POST', { slideIds: ['s1', 's2'], label: null })).status === 400, '400 for sample-deck slide ids');
check((await call(packsRoute.POST, 'POST', { slideIds: [crypto.randomUUID(), crypto.randomUUID()], label: null })).status === 404, '404 for slides that no longer exist');
const signedOut = await call(packsRoute.POST, 'POST', { slideIds: [A.slides[4], A.slides[5]], label: null }, {}, null);
check(signedOut.status === 400 && signedOut.json.error?.code === 'SIGNED_OUT', 'signed out: 400 SIGNED_OUT, not 401');

// ---- Every member carries the whole pack
const listed = await withPacks(await searchSlidesPg('', 100));
const members = listed.filter((s) => s.pack);
check(members.length === 3 && members.every((s) => s.pack!.id === packId && s.pack!.slideIds.length === 3 && s.pack!.slideIds[0] === A.slides[2]), 'each member carries the same pack, in order');
check(listed.filter((s) => !s.pack).length === 6, 'slides in no pack carry none');

// ---- Rename, unconfirm, confirm
const renamed = await call(packRoute.PATCH, 'PATCH', { label: 'Process' }, { packId });
check(renamed.status === 200 && renamed.json.data?.label === 'Process', 'PATCH label renames it');
const un = await call(packRoute.PATCH, 'PATCH', { status: 'suggested' }, { packId });
check(un.json.data?.status === 'suggested' && un.json.data?.confirmedBy === null, 'PATCH status suggested unconfirms and clears who');
const re = await call(packRoute.PATCH, 'PATCH', { status: 'confirmed' }, { packId }, 'Sam Lee');
check(re.json.data?.status === 'confirmed' && re.json.data?.confirmedBy === 'Sam Lee' && !!re.json.data?.confirmedAt, 'PATCH status confirmed records who and when');
check((await call(packRoute.PATCH, 'PATCH', { status: 'maybe' }, { packId })).status === 400, 'PATCH with an unknown status is a 400');
check((await call(packRoute.PATCH, 'PATCH', { label: 'x' }, { packId: crypto.randomUUID() })).status === 404, 'PATCH on an unknown pack is a 404');

// ---- Dismissing a suggestion keeps it, as dismissed; ungrouping a person's pack removes it
const [sug] = await sql<{ id: string }>(`insert into slide_packs (deck_id, label, source) values ($1, 'Suggested', 'import') returning id`, [A.id]);
await sql(`insert into slide_pack_members (pack_id, slide_id, position) values ($1, $2, 1), ($1, $3, 2)`, [sug.id, A.slides[4], A.slides[5]]);
const dis = await call(packRoute.DELETE, 'DELETE', undefined, { packId: sug.id });
const [after] = await sql<{ status: string; dismissed_by: string }>('select status, dismissed_by from slide_packs where id = $1', [sug.id]);
check(dis.status === 200 && dis.json.data?.dismissed === true && after?.status === 'dismissed' && after.dismissed_by === 'Pat Doe', 'DELETE on a suggestion keeps it as dismissed, with who');
check(!(await withPacks(await searchSlidesPg('', 100))).some((s) => s.pack?.id === sug.id), 'a dismissed pack is no longer shown on slides');
check((await call(packRoute.DELETE, 'DELETE', undefined, { packId: sug.id })).status === 404, 'a dismissed pack is gone for the app (404)');
const reuse = await call(packsRoute.POST, 'POST', { slideIds: [A.slides[4], A.slides[5]], label: null });
check(reuse.status === 200, 'slides of a dismissed suggestion can go in a new pack');
const ungroup = await call(packRoute.DELETE, 'DELETE', undefined, { packId });
const [gone] = await sql<{ n: string }>('select count(*) as n from slide_packs where id = $1', [packId]);
const [slidesLeft] = await sql<{ n: string }>('select count(*) as n from slides where deck_id = $1', [A.id]);
check(ungroup.json.data?.dismissed === false && gone.n === '0' && slidesLeft.n === '6', "DELETE on a person's pack removes the pack, never the slides");

// ---- Archive and restore
const arch = await call(deckRoute.PATCH, 'PATCH', { archived: true }, { deckId: B.id });
check(arch.status === 200 && arch.json.data?.archived === true && arch.json.data?.archivedBy === 'Pat Doe', 'PATCH /decks/:id archives, recording who');
const ids = async (a?: 'include' | 'only') => new Set((await searchSlidesPg('', 100, a)).map((s) => s.provenance.sourceId));
check(!(await ids()).has(B.id), 'archived decks are left out by default');
const inc = await searchSlidesPg('', 100, 'include');
const bSlide = inc.find((s) => s.provenance.sourceId === B.id);
check(!!bSlide && bSlide.provenance.archived === true && bSlide.provenance.archivedBy === 'Pat Doe' && !!bSlide.provenance.archivedAt, 'archived=include marks them archived, with who and when');
check(!inc.find((s) => s.provenance.sourceId === A.id)?.provenance.archived, 'decks that are not archived are not marked');
const only = await ids('only');
check(only.size === 1 && only.has(B.id), 'archived=only lists just the archived decks');
const restore = await call(deckRoute.PATCH, 'PATCH', { archived: false }, { deckId: B.id });
check(restore.json.data?.archived === false && (await ids()).has(B.id), 'archived: false restores it');
check((await call(deckRoute.PATCH, 'PATCH', { archived: 'yes' }, { deckId: B.id })).status === 400, 'archived must be true or false');
check((await call(deckRoute.PATCH, 'PATCH', { archived: true }, { deckId: crypto.randomUUID() })).status === 404, 'unknown deck is a 404');

// ---- Deck details on every slide
await sql(`update decks set created_by = 'Alex Kim', file_created_at = '2025-06-20T10:00:00Z', uploaded_by = 'Vincent Mizhquiri', project_location = 'New York' where id = $1`, [A.id]);
const p = (await searchSlidesPg('', 100)).find((s) => s.provenance.sourceId === A.id)!.provenance;
check(p.createdBy === 'Alex Kim' && p.uploadedBy === 'Vincent Mizhquiri' && p.createdAt === '2025-06-20T10:00:00.000Z' && !!p.uploadedAt && p.location === 'New York', 'provenance carries created by, uploaded by, both dates and location');
const q = (await searchSlidesPg('', 100)).find((s) => s.provenance.sourceId === B.id)!.provenance;
check(q.createdBy === null && q.uploadedBy === null && q.createdAt === null, 'unknown details are null, never guessed');
const core = readCoreXml('<cp:coreProperties><dc:creator>Jo &amp; Co</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2024-03-01T09:00:00Z</dcterms:created></cp:coreProperties>');
check(core.createdBy === 'Jo & Co' && core.createdAt === '2024-03-01T09:00:00.000Z', "reads author and date from PowerPoint's core.xml");
check(readCoreXml('<cp:coreProperties/>').createdBy === null, 'a file with no author stays unknown');

// ---- The library lists every slide, not just the first page's worth
const C = await deck('Deck C', 1200);
const all = await searchSlidesPg('', 1000);
check(all.filter((s) => s.provenance.sourceId === C.id).length === 1200 && all.length === 1209, 'listing the library returns every slide (no 1,000 cap)', all.length);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll pack, archive and deck-detail checks passed');
await sql('drop table if exists free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
process.exit(failures ? 1 : 0);
