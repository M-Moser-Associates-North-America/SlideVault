/**
 * Per-person data and download counts (docs/DECISIONS.md FD-18), against a LOCAL test database.
 *
 * It writes and deletes rows, so it refuses to run against anything but a database on this
 * computer with SSL off. Point SV_DB_* at a throwaway local Postgres (see docs/DECISIONS.md FD-18
 * for the setup used), never at M Moser's project:
 *
 *   SV_DB_HOST=localhost SV_DB_SSL=disable ... npm run test:user-data
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
if (!['localhost', '127.0.0.1'].includes(env.SV_DB_HOST ?? '') || env.SV_DB_SSL !== 'disable') {
  console.log('Skipped: test:user-data only runs against a local test database (SV_DB_HOST=localhost, SV_DB_SSL=disable).');
  process.exit(0);
}
// The route helpers need the full SV_* set to count as "configured"; storage isn't used here.
for (const k of ['SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX']) env[k] ??= 'unused-in-this-test';

const { sql } = await import('../features/slide-vault/server/db');
const data = await import('../features/slide-vault/server/user-data');
const { userOf } = await import('../features/slide-vault/server/principal');
const { resetRateLimits } = await import('../features/slide-vault/server/rate-limit');
const savedRoute = await import('../app/api/slide-vault/v1/me/saved/route');
const draftsRoute = await import('../app/api/slide-vault/v1/me/drafts/route');
const draftRoute = await import('../app/api/slide-vault/v1/me/drafts/[draftId]/route');
const activityRoute = await import('../app/api/slide-vault/v1/me/activity/route');

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);
}

// Fresh tables, then the schema twice to prove it's safe to rerun.
await sql('drop table if exists activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
const schema = readFileSync(path.resolve(import.meta.dirname, '../features/slide-vault/server/sql/schema.sql'), 'utf8');
await sql(schema);
await sql(schema);
check(true, 'schema.sql runs twice without errors');

// ---- Who is asking
const req = (headers: Record<string, string> = {}, init: RequestInit = {}) => new Request('http://localhost/x', { ...init, headers });
check(userOf(req({ 'x-slidevault-user': 'Person%20A' })) === 'Person A', 'principal: reads the signed-in name');
check(userOf(req()) === null && userOf(req({ 'x-slidevault-user': '%0Abad' })) === null && userOf(req({ 'x-slidevault-user': 'x'.repeat(81) })) === null, 'principal: missing, control characters or too long means nobody');

// ---- Most downloaded
await data.recordDownloads(['s1', 's2', 's1']);
await data.recordDownloads(['s1']);
const counts = (await data.downloadCounts(['s1', 's2', 's3'])) ?? new Map<string, number>();
check(counts.get('s1') === 2 && counts.get('s2') === 1 && !counts.has('s3'), 'downloads: counted once per download, per slide', [...counts]);
const withCounts = await data.withDownloadCounts<{ id: string; downloads?: number }>([{ id: 's1' }, { id: 's3' }]);
check(withCounts[0].downloads === 2 && withCounts[1].downloads === 0, 'downloads: slides never downloaded read as 0');
const savedHost = env.SV_DB_HOST;
delete env.SV_DB_HOST;
const unknown = await data.downloadCounts(['s1']);
const untouched = await data.withDownloadCounts<{ id: string; downloads?: number }>([{ id: 's1' }]);
env.SV_DB_HOST = savedHost;
check(unknown === null && !('downloads' in untouched[0]), 'downloads: with no database, counts are unknown (left off), not 0');
const noNames = await sql<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'slide_downloads'`);
check(!noNames.some((c) => /user/.test(c.column_name)), 'downloads: the count table stores no names');

// ---- Saved slides, through the routes
resetRateLimits();
const as = (user: string, method: string, body?: unknown) =>
  new Request('http://localhost/x', { method, headers: { 'x-slidevault-user': encodeURIComponent(user), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as { data?: Record<string, unknown>; error?: { code: string } } });

await savedRoute.PATCH(as('Ana', 'PATCH', { slideId: 's1', saved: true }));
await savedRoute.PATCH(as('Ana', 'PATCH', { slideId: 's2', saved: true }));
await savedRoute.PATCH(as('Ana', 'PATCH', { slideId: 's2', saved: true }));
await savedRoute.PATCH(as('Ben', 'PATCH', { slideId: 's9', saved: true }));
await savedRoute.PATCH(as('Ana', 'PATCH', { slideId: 's1', saved: false }));
const anaSaved = await json(await savedRoute.GET(as('Ana', 'GET')));
check(JSON.stringify(anaSaved.body.data?.slideIds) === '["s2"]', 'saved: save, save again, unsave; only my own slides come back', anaSaved);
const signedOut = await json(await savedRoute.GET(req()));
check(signedOut.status === 400 && signedOut.body.error?.code === 'SIGNED_OUT', 'saved: no signed-in person is refused');
const badSave = await json(await savedRoute.PATCH(as('Ana', 'PATCH', { slideId: 's1' })));
check(badSave.status === 400, 'saved: a request without saved: true/false is refused');

// ---- My decks
const made = await json(await draftsRoute.POST(as('Ana', 'POST', { name: '  Bank pitch  ', slideIds: ['s2', 's1'] })));
const draft = made.body.data?.draft as { id: string; name: string; slideIds: string[] };
check(made.status === 200 && draft.name === 'Bank pitch' && JSON.stringify(draft.slideIds) === '["s2","s1"]', 'drafts: saved with its name trimmed and slide order kept', made);
const benList = await json(await draftsRoute.GET(as('Ben', 'GET')));
check((benList.body.data?.drafts as unknown[]).length === 0, "drafts: another person can't see my decks");
const benDelete = await draftRoute.DELETE(as('Ben', 'DELETE'), { params: Promise.resolve({ draftId: draft.id }) });
check(benDelete.status === 404, "drafts: another person can't delete my deck");
const anaDelete = await draftRoute.DELETE(as('Ana', 'DELETE'), { params: Promise.resolve({ draftId: draft.id }) });
const anaAfter = await json(await draftsRoute.GET(as('Ana', 'GET')));
check(anaDelete.status === 200 && (anaAfter.body.data?.drafts as unknown[]).length === 0, 'drafts: I can delete my own deck');
check((await draftsRoute.POST(as('Ana', 'POST', { name: '', slideIds: [] }))).status === 400, 'drafts: a deck needs a name');
check((await draftRoute.DELETE(as('Ana', 'DELETE'), { params: Promise.resolve({ draftId: 'not-a-uuid' }) })).status === 404, 'drafts: a bad id is just not found');

// ---- Opt-in activity
const post = (user: string, body: unknown) => activityRoute.POST(as(user, 'POST', body));
let r = await json(await post('Ana', { kind: 'viewed', slideId: 's1', label: 'Team' }));
check(r.body.data?.recorded === false, 'activity: nothing is recorded before opting in');
let got = await json(await activityRoute.GET(as('Ana', 'GET')));
check(got.body.data?.optedIn === false && (got.body.data?.entries as unknown[]).length === 0 && got.body.data?.retentionDays === 90, 'activity: off by default, 90-day retention reported', got);

await activityRoute.PATCH(as('Ana', 'PATCH', { optedIn: true }));
r = await json(await post('Ana', { kind: 'viewed', slideId: 's1', label: 'Team' }));
await post('Ana', { kind: 'downloaded', slideId: 's2', label: 'Cost' });
await post('Ben', { kind: 'viewed', slideId: 's9' });
got = await json(await activityRoute.GET(as('Ana', 'GET')));
const entries = got.body.data?.entries as { kind: string; slideId?: string; at: number }[];
check(r.body.data?.recorded === true && entries.length === 2 && entries[0].kind === 'downloaded' && typeof entries[0].at === 'number', 'activity: once opted in, my events come back newest first', got);
check((await json(await activityRoute.GET(as('Ben', 'GET')))).body.data?.optedIn === false, "activity: opting in is per person (Ben's events weren't recorded)");
check((await post('Ana', { kind: 'hacked' })).status === 400, 'activity: unknown kinds are refused');

await sql(`insert into activity_events (user_key, kind, slide_id, at) values ('Ana', 'viewed', 'old', now() - interval '91 days'), ('Zoe', 'viewed', 'old', now() - interval '120 days')`);
await post('Ana', { kind: 'saved', slideId: 's3' });
const old = await sql<{ n: number }>(`select count(*)::int as n from activity_events where at < now() - interval '90 days'`);
check(old[0].n === 0, "activity: anything older than 90 days is deleted (everyone's, not just mine)");

await activityRoute.PATCH(as('Ana', 'PATCH', { optedIn: false }));
const left = await sql<{ n: number }>(`select count(*)::int as n from activity_events where user_key = 'Ana'`);
got = await json(await activityRoute.GET(as('Ana', 'GET')));
check(left[0].n === 0 && got.body.data?.optedIn === false, 'activity: opting out deletes everything recorded for me');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll user data checks passed');
process.exit(failures ? 1 : 0);
