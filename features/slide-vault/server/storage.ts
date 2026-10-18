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

async function put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const sb = await storage();
  const { error } = await sb.storage.from(bucket()).upload(key, new Blob([new Uint8Array(bytes)], { type: contentType }), { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

async function get(key: string): Promise<Uint8Array> {
  const sb = await storage();
  const { data, error } = await sb.storage.from(bucket()).download(key);
  if (error || !data) throw new Error(error?.message ?? 'not found');
  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadOriginal(deckId: string, bytes: Uint8Array): Promise<string> {
  const key = `${prefix()}/originals/${deckId}.pptx`;
  try {
    await put(key, bytes, PPTX_CONTENT_TYPE);
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
