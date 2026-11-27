import 'server-only';
import JSZip from 'jszip';

/** Reads the deck's slide size from presentation.xml and classifies it as 16:9 or 4:3. */
export async function readSlideSize(pptx: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(pptx);
  const xml = await zip.file('ppt/presentation.xml')?.async('string');
  const match = xml?.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!match) return 'unknown';
  const ratio = Number(match[1]) / Number(match[2]);
  const closestTo = (target: number) => Math.abs(ratio - target);
  return closestTo(16 / 9) <= closestTo(4 / 3) ? '16:9' : '4:3';
}
