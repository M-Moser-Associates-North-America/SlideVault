import 'server-only';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractSlides } from '../../../../workers/slide-vault/processors/extract-text';
import { renderPreviews } from '../../../../workers/slide-vault/processors/render-previews';
import type { UploadPreview } from '../../contracts/dto';
import { ServiceError } from '../http';
import { findDeckByHash } from '../pg-repository';

/**
 * Upload preview (docs/DECISIONS.md FD-54): the slides of a chosen .pptx as pictures, before anything
 * is stored. Nothing goes to the database or the bucket. The pictures sit in this server's temporary
 * folder, under the file's SHA-256, for PREVIEW_HOURS; if the person then uploads the same file, the
 * upload reuses them instead of rendering again.
 */
const PREVIEW_HOURS = 2;
const root = () => path.join(tmpdir(), 'slidevault-preview');
const TOKEN = /^[0-9a-f]{64}$/;

/** The folder holding a rendered preview, or null when it isn't (fully) there. */
export function cachedPreviewDir(fileHash: string): string | null {
  if (!TOKEN.test(fileHash)) return null;
  const dir = path.join(root(), fileHash);
  return existsSync(path.join(dir, 'slides.json')) ? dir : null;
}

/** Drop previews older than PREVIEW_HOURS so the temporary folder doesn't grow. */
function sweep() {
  if (!existsSync(root())) return;
  const cutoff = Date.now() - PREVIEW_HOURS * 3600_000;
  for (const name of readdirSync(root())) {
    const dir = path.join(root(), name);
    try {
      if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}

export async function previewUpload(fileName: string, bytes: Uint8Array): Promise<UploadPreview> {
  if (!fileName.toLowerCase().endsWith('.pptx')) throw new ServiceError(415, 'UNSUPPORTED_FILE_TYPE', 'Only .pptx files are accepted.');
  sweep();
  const hash = createHash('sha256').update(bytes).digest('hex');
  let dir = cachedPreviewDir(hash);
  if (!dir) {
    mkdirSync(root(), { recursive: true });
    const work = path.join(root(), `${hash}.partial-${process.pid}-${Date.now()}`);
    mkdirSync(work);
    try {
      const slides = await extractSlides(bytes);
      await renderPreviews(bytes, work, (n) => `${n}.png`);
      writeFileSync(path.join(work, 'slides.json'), JSON.stringify(slides.map((s) => ({ number: s.number, title: s.title, text: s.text, hidden: s.hidden }))));
      const final = path.join(root(), hash);
      rmSync(final, { recursive: true, force: true });
      renameSync(work, final);
      dir = final;
    } catch (e) {
      rmSync(work, { recursive: true, force: true });
      throw new ServiceError(422, 'UPLOAD_FAILED', `This file could not be previewed: ${(e as Error).message}`);
    }
  }
  const slides = JSON.parse(readFileSync(path.join(dir, 'slides.json'), 'utf8')) as { number: number; title: string; hidden: boolean }[];
  let alreadyUploadedAs: string | null = null;
  try {
    alreadyUploadedAs = (await findDeckByHash(hash))?.title ?? null;
  } catch {
    /* no database here: the preview still works */
  }
  return {
    token: hash,
    fileName,
    slideCount: slides.length,
    alreadyUploadedAs,
    slides: slides.map((s) => ({ number: s.number, title: s.title || `Slide ${s.number}`, hiddenInSource: s.hidden, previewPath: `/uploads/preview/${hash}/${s.number}` })),
  };
}

/** One preview picture, or null when the preview has expired or never existed. */
export function previewImage(token: string, slideNumber: string): Uint8Array | null {
  if (!/^\d{1,4}$/.test(slideNumber)) return null;
  const dir = cachedPreviewDir(token);
  if (!dir) return null;
  const file = path.join(dir, `${Number(slideNumber)}.png`);
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
}

/**
 * The words of a previewed file's slides, for tag suggestions in the upload form (FD-82). Read from the
 * temporary preview folder; null when the preview has expired. A preview made before this change has
 * titles only, which still works, a little less well.
 */
export function previewSlideTexts(token: string): { number: number; title: string; text?: string; hidden: boolean }[] | null {
  const dir = cachedPreviewDir(token);
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(path.join(dir, 'slides.json'), 'utf8'));
  } catch {
    return null;
  }
}
