import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { liveV3Page } from '@/features/slide-vault/v3/live';

// GET /v3: Khushali's approved V3 design, running on the real library (features/slide-vault/v3/live.ts).
// The current React screen at /slide-vault stays as it is until V3 is split into components.
export async function GET() {
  const original = await readFile(path.join(process.cwd(), 'features/slide-vault/v3/SlideVault-v3.html'), 'utf8');
  const page = liveV3Page(original);
  if (page.missing.length) console.warn('V3 live data not applied, running on samples. Missing anchors:', page.missing);
  return new Response(page.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
