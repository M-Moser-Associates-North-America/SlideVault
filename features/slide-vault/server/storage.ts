import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readConfig, readMmoserConfig } from './config';

/**
 * File storage in M Moser's Supabase project (docs/DECISIONS.md FD-12).
 *
 * Signs in with the developer's own Storage account (SV_STORAGE_*), then uses one private
 * bucket and only that developer's upload folder (SV_STORAGE_PREFIX):
 *   <prefix>/originals/<deck id>.pptx          the untouched original deck
 *   <prefix>/previews/<deck id>/0001.png        one thumbnail per slide
 *
 * The bucket's rules allow uploading and reading, not overwriting or deleting, so every key is
 * new (deck ids are random) and nothing here deletes.
 *
 * Until the bucket accepts images, thumbnails are kept on this computer instead
 * (<data dir>/uploaded-previews) and their key starts with "local:". Remove the fallback
 * once PNG uploads are allowed.
 */

const PPTX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const LOCAL = 'local:';

let client: SupabaseClient | null = null;
let signingIn: Promise<SupabaseClient> | null = null;

/** Storage client signed in as this developer. Signs in once and reuses the session. */
async function storage(): Promise<SupabaseClient> {
  if (client) return client;
  signingIn ??= (async () => {
    const c = readMmoserConfig().storage;
    const sb = createClient(c.url, c.publishableKey, { auth: { persistSession: false, autoRefreshToken: true } });
    const { error } = await sb.auth.signInWithPassword({ email: c.email, password: c.password });
    if (error) {
      signingIn = null;
      throw new Error(`Could not sign in to file storage: ${error.message}`);
    }
    client = sb;
    return sb;
  })();
  return signingIn;
}

const bucket = () => readMmoserConfig().storage.bucket;
const prefix = () => readMmoserConfig().storage.prefix;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Network hiccups and server errors are worth retrying; a rule the bucket enforces is not. */
const isTransient = (message: string) => /fetch failed|network|timeout|timed out|socket|ECONN|EPIPE|502|503|504|gateway/i.test(message);
const isAlreadyThere = (message: string) => /already exists|duplicate/i.test(message);

/**
 * Store a file, never overwriting (the bucket doesn't allow it). Retries network hiccups a few times.
 * If the exact key already exists, that's treated as done: it happens when a failed deck is
 * processed again and some of its files were stored the first time.
 */
async function put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const sb = await storage();
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.storage.from(bucket()).upload(key, new Blob([new Uint8Array(bytes)], { type: contentType }), { contentType, upsert: false });
    if (!error || isAlreadyThere(error.message)) return;
    if (attempt >= 4 || !isTransient(error.message)) throw new Error(error.message);
    await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s
  }
}

async function get(key: string): Promise<Uint8Array> {
  const sb = await storage();
  const { data, error } = await sb.storage.from(bucket()).download(key);
  if (error || !data) throw new Error(error?.message ?? 'not found');
  return new Uint8Array(await data.arrayBuffer());
}

/** Files bigger than this go up in 6 MB pieces (resumable upload) instead of one long request. */
const RESUMABLE_FROM = 50 * 1024 * 1024;
const CHUNK = 6 * 1024 * 1024; // Supabase's required piece size for resumable uploads

/**
 * Resumable (TUS) upload, the way Supabase recommends for large files: one request creates the
 * upload, then the file goes up in 6 MB pieces. A piece that fails is retried from where the server
 * says it got to, so a 500 MB deck never depends on one 20-minute request staying connected.
 * Never overwrites (x-upsert: false), like put().
 */
async function putResumable(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const sb = await storage();
  const c = readMmoserConfig().storage;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in to file storage');
  const endpoint = `${c.url.replace(/\/$/, '')}/storage/v1/upload/resumable`;
  const auth = { authorization: `Bearer ${token}`, apikey: c.publishableKey, 'tus-resumable': '1.0.0' };
  const b64 = (v: string) => Buffer.from(v).toString('base64');

  const created = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...auth,
      'upload-length': String(bytes.length),
      'upload-metadata': `bucketName ${b64(bucket())},objectName ${b64(key)},contentType ${b64(contentType)},cacheControl ${b64('3600')}`,
      'x-upsert': 'false',
    },
  });
  if (created.status === 409) return; // already stored by an earlier attempt
  if (!created.ok) throw new Error(`could not start the upload (${created.status} ${await created.text().catch(() => '')})`.trim());
  const location = created.headers.get('location');
  if (!location) throw new Error('could not start the upload (no upload address returned)');
  const uploadUrl = new URL(location, endpoint).toString();

  let offset = 0;
  let failures = 0;
  while (offset < bytes.length) {
    const piece = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
    try {
      const res = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: { ...auth, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
        body: new Uint8Array(piece),
      });
      if (!res.ok) throw new Error(`piece at ${offset} refused (${res.status} ${await res.text().catch(() => '')})`.trim());
      offset = Number(res.headers.get('upload-offset') ?? offset + piece.length);
      failures = 0;
    } catch (e) {
      if (++failures > 5) throw e;
      await sleep(1000 * 2 ** (failures - 1));
      // Ask the server how much it really has, then carry on from there.
      const head = await fetch(uploadUrl, { method: 'HEAD', headers: auth }).catch(() => null);
      const got = Number(head?.headers.get('upload-offset'));
      if (Number.isFinite(got) && got >= 0) offset = got;
    }
  }
}

export async function uploadOriginal(deckId: string, bytes: Uint8Array): Promise<string> {
  const key = `${prefix()}/originals/${deckId}.pptx`;
  try {
    if (bytes.length > RESUMABLE_FROM) await putResumable(key, bytes, PPTX_CONTENT_TYPE);
    else await put(key, bytes, PPTX_CONTENT_TYPE);
  } catch (e) {
    throw new Error(`Could not store the original file: ${(e as Error).message}`);
  }
  return key;
}

const localPreviewFile = (key: string) => path.join(readConfig().dataDir, 'uploaded-previews', key.slice(LOCAL.length));

export async function uploadPreview(deckId: string, slideNumber: number, bytes: Uint8Array): Promise<string> {
  const key = `${prefix()}/previews/${deckId}/${String(slideNumber).padStart(4, '0')}.png`;
  try {
    await put(key, bytes, 'image/png');
    return key;
  } catch (e) {
    const message = (e as Error).message;
    if (!/mime type .* is not supported/i.test(message)) throw new Error(`Could not store the preview for slide ${slideNumber}: ${message}`);
    // The bucket doesn't accept images yet: keep this thumbnail on this computer for now.
    const local = `${LOCAL}${key}`;
    await mkdir(path.dirname(localPreviewFile(local)), { recursive: true });
    await writeFile(localPreviewFile(local), bytes);
    return local;
  }
}

export async function downloadPreview(storageKey: string): Promise<Uint8Array> {
  try {
    if (storageKey.startsWith(LOCAL)) return new Uint8Array(await readFile(localPreviewFile(storageKey)));
    return await get(storageKey);
  } catch (e) {
    throw new Error(`Could not load the preview: ${(e as Error).message}`);
  }
}

/** The untouched original deck, for building a download (the export only ever reads it). */
export async function downloadOriginal(storageKey: string): Promise<Uint8Array> {
  try {
    return await get(storageKey);
  } catch (e) {
    throw new Error(`Could not load the original deck: ${(e as Error).message}`);
  }
}
