import 'server-only';
import { supabaseAdmin } from './supabase';

/**
 * Private object storage (supabase/migrations: slide-originals, slide-previews buckets).
 * Both buckets are private; access goes through the authorized API routes only, never
 * a public bucket URL (docs/SECURITY_AND_OPERATIONS.md).
 */

const PPTX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export async function uploadOriginal(deckId: string, bytes: Uint8Array): Promise<string> {
  const key = `${deckId}/original.pptx`;
  const { error } = await supabaseAdmin()
    .storage.from('slide-originals')
    .upload(key, bytes, { contentType: PPTX_CONTENT_TYPE, upsert: false });
  if (error) throw new Error(`Could not store the original file: ${error.message}`);
  return key;
}

export async function uploadPreview(deckId: string, slideNumber: number, bytes: Uint8Array): Promise<string> {
  const key = `${deckId}/${String(slideNumber).padStart(4, '0')}.png`;
  const { error } = await supabaseAdmin()
    .storage.from('slide-previews')
    .upload(key, bytes, { contentType: 'image/png', upsert: false });
  if (error) throw new Error(`Could not store the preview for slide ${slideNumber}: ${error.message}`);
  return key;
}

export async function downloadPreview(storageKey: string): Promise<Uint8Array> {
  const { data, error } = await supabaseAdmin().storage.from('slide-previews').download(storageKey);
  if (error || !data) throw new Error(`Could not load the preview: ${error?.message ?? 'not found'}`);
  return new Uint8Array(await data.arrayBuffer());
}
