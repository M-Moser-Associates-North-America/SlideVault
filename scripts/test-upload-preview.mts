/**
 * Upload preview, tags at upload and tidy author names (docs/DECISIONS.md FD-54).
 * The preview part needs soffice and pdftoppm (like test:export). The tags part needs a LOCAL test
 * database and is skipped without one (SV_DB_HOST=localhost, SV_DB_SSL=disable).
 *
 *   npm run test:upload-preview
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
const localDb = ['localhost', '127.0.0.1'].includes(env.SV_DB_HOST ?? '') && env.SV_DB_SSL === 'disable';
for (const k of ['SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX']) if (localDb) env[k] ??= 'unused-in-this-test';

const { previewUpload, previewImage, cachedPreviewDir } = await import('../features/slide-vault/server/services/upload-preview');
const { tidyPersonName } = await import('../features/slide-vault/server/file-facts');
const { resetRateLimits } = await import('../features/slide-vault/server/rate-limit');
const previewRoute = await import('../app/api/slide-vault/v1/uploads/preview/route');
const imageRoute = await import('../app/api/slide-vault/v1/uploads/preview/[token]/[slide]/route');

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);
}

// ---- Tidy author names
check(tidyPersonName('JordanEllis - M Moser Associates') === 'Jordan Ellis', 'tidies "JordanEllis - M Moser Associates"');
check(tidyPersonName('TaylorMorgan - M Moser Associates') === 'Taylor Morgan', 'tidies "TaylorMorgan - M Moser Associates"');
check(tidyPersonName('Sam K') === 'Sam K', 'leaves a name with a space alone');
check(tidyPersonName('McDonald') === 'McDonald' && tidyPersonName('DeAndre') === 'DeAndre', 'does not split McDonald or DeAndre');
check(tidyPersonName(null) === null && tidyPersonName('') === null, 'unknown stays unknown');

// ---- Upload preview: real pictures, nothing stored
const file = path.resolve(import.meta.dirname, '../tests/fixtures/northwind-capabilities.pptx');
const bytes = new Uint8Array(readFileSync(file));
const t0 = Date.now();
const p = await previewUpload('northwind-capabilities.pptx', bytes);
const firstMs = Date.now() - t0;
check(p.slideCount > 0 && p.slides.length === p.slideCount && /^[0-9a-f]{64}$/.test(p.token), 'preview lists every slide with a token', { slideCount: p.slideCount });
check(p.slides.every((s) => s.previewPath === `/uploads/preview/${p.token}/${s.number}`), 'each slide has a picture path');
const png = previewImage(p.token, '1');
check(!!png && png[0] === 0x89 && png[1] === 0x50, 'the picture is a real PNG');
const t1 = Date.now();
await previewUpload('northwind-capabilities.pptx', bytes);
check(Date.now() - t1 < Math.max(500, firstMs / 3), 'the same file again reuses the pictures (no second render)', { firstMs, againMs: Date.now() - t1 });
check(!!cachedPreviewDir(p.token), 'the upload can find the rendered pictures to reuse');
check(previewImage(p.token, '999') === null && previewImage('nope', '1') === null && previewImage(p.token, '../../etc') === null, 'unknown slides, bad tokens and odd paths give nothing');

resetRateLimits();
const form = new FormData();
form.set('file', new File([bytes], 'northwind-capabilities.pptx'));
const res = await previewRoute.POST(new Request('http://localhost/x', { method: 'POST', body: form }));
const body = (await res.json()) as { data?: { slideCount: number; token: string } };
check(res.status === 200 && body.data?.slideCount === p.slideCount, 'POST /uploads/preview answers with the slides');
const bad = new FormData();
bad.set('file', new File([new Uint8Array([1, 2, 3])], 'notes.txt'));
check((await previewRoute.POST(new Request('http://localhost/x', { method: 'POST', body: bad }))).status === 415, 'only .pptx is accepted');
const img = await imageRoute.GET(new Request('http://localhost/x'), { params: Promise.resolve({ token: p.token, slide: '1' }) } as never);
check(img.status === 200 && img.headers.get('content-type') === 'image/png', 'GET /uploads/preview/:token/:slide serves the picture');
const gone = await imageRoute.GET(new Request('http://localhost/x'), { params: Promise.resolve({ token: '0'.repeat(64), slide: '1' }) } as never);
check(gone.status === 404, 'an expired or unknown preview is a 404');

// ---- Tags saved with an upload (local database only)
if (localDb) {
  const { sql } = await import('../features/slide-vault/server/db');
  const { addUploadTags } = await import('../features/slide-vault/server/tags');
  await sql('drop table if exists free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
  await sql(readFileSync(path.resolve(import.meta.dirname, '../features/slide-vault/server/sql/schema.sql'), 'utf8'));
  const [d] = await sql<{ id: string }>(`insert into decks (client, title, source_path, source_filename, file_path, file_hash, status, slide_count) values ('Acme', 'Deck', 'x', 'Deck', 'p', 'h', 'ready', 3) returning id`);
  await sql(`insert into slides (deck_id, slide_number) select $1, g from generate_series(1, 3) g`, [d.id]);
  const n = await addUploadTags(d.id, ['Healthcare', '  ', 'healthcare'], { '2': ['Team', 'x'.repeat(61)], '9': ['Nowhere'] }, 'Pat Doe');
  const rows = await sql<{ target_kind: string; tag: string; added_by: string }>('select target_kind, tag, added_by from free_tags order by tag');
  check(n === 2 && rows.length === 2 && rows.some((r) => r.target_kind === 'deck' && r.tag === 'Healthcare') && rows.some((r) => r.target_kind === 'slide' && r.tag === 'Team') && rows.every((r) => r.added_by === 'Pat Doe'),
    'upload tags: deck and slide tags saved by who uploaded; blanks, too-long, repeats and unknown slides skipped', rows);
  await sql('drop table if exists free_tags, slide_pack_members, slide_packs, story_feedback, activity_events, user_settings, drafts, saved_slides, slide_downloads, slides, decks cascade');
} else {
  console.log('Skipped the upload-tags part: no local test database (SV_DB_HOST=localhost, SV_DB_SSL=disable).');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll upload preview checks passed');
process.exit(failures ? 1 : 0);
