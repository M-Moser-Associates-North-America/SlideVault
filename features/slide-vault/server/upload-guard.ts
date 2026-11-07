import 'server-only';
import { fail } from './http';

/**
 * What an upload must be before anything reads it (docs/DECISIONS.md FD-93; docs/SECURITY_AND_OPERATIONS.md):
 * no bigger than SV_UPLOAD_MAX_MB (default 1024: M Moser's largest real deck is about 910 MB), and really a
 * .pptx inside, not just by name: a .pptx is a zip file, so it starts with the bytes "PK\x03\x04".
 */
export function uploadMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const mb = Number(env.SV_UPLOAD_MAX_MB || 1024);
  return (Number.isFinite(mb) && mb >= 1 && mb <= 4096 ? mb : 1024) * 1024 * 1024;
}

const tooBig = (max: number) => fail(413, 'FILE_TOO_LARGE', `That file is too big. Decks up to ${Math.round(max / 1048576)} MB can be uploaded.`);

/** Before the form is read: a request that says it's bigger than the limit is turned away without reading it. */
export function checkUploadSize(request: Request, max = uploadMaxBytes()): Response | null {
  const length = Number(request.headers.get('content-length') ?? 0);
  // A little room for the form's other fields.
  return length > max + 1024 * 1024 ? tooBig(max) : null;
}

/** The file itself: its real size, its name and its first bytes. Null when it may go ahead. */
export async function checkUploadFile(file: File, max = uploadMaxBytes()): Promise<Response | null> {
  if (!file.name.toLowerCase().endsWith('.pptx')) return fail(415, 'UNSUPPORTED_FILE_TYPE', 'Only .pptx files are accepted.');
  if (file.size > max) return tooBig(max);
  if (file.size < 4) return fail(415, 'UNSUPPORTED_FILE_TYPE', 'That file is empty or not a real .pptx.');
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  return isZip ? null : fail(415, 'UNSUPPORTED_FILE_TYPE', 'That file is named .pptx but is not a PowerPoint file.');
}
