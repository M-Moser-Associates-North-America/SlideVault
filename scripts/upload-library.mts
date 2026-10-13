/**
 * Upload a whole SharePoint-style library folder through POST /uploads, reading year, client,
 * category and Best of the Best from each deck's folder path (features/slide-vault/server/folder-path.ts).
 *
 *   npm run upload:library                                   # the synthetic library, to http://localhost:3000
 *   npm run upload:library -- "<library folder>" [base URL]
 *
 * Needs the app running (npm run dev) with Supabase set up in .env.local.
 * Safe to run twice: a file already uploaded is skipped, or, when it sits in a second folder (a Best of the
 * Best copy of a submittal), the existing deck gets that folder's details added (FD-11).
 * Never point this at real client decks unless that's been approved (env.example).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { folderInfo } from '../features/slide-vault/server/folder-path';

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../tests/fixtures/sharepoint-library'));
const base = (process.argv[3] ?? 'http://localhost:3000').replace(/\/$/, '');
const API = `${base}/api/slide-vault/v1/uploads`;

const walk = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      if (name.startsWith('.') || name.startsWith('~$')) return []; // hidden files and Office lock files
      return statSync(full).isDirectory() ? walk(full) : name.toLowerCase().endsWith('.pptx') ? [full] : [];
    });

const decks = walk(root);
console.log(`Uploading ${decks.length} decks from ${root}\n`);
const tally = { uploaded: 0, updated: 0, skipped: 0, failed: 0 };

for (const file of decks) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const info = folderInfo(rel);
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)]), path.basename(file));
  if (info.clientName) form.append('clientName', info.clientName);
  if (info.deckYear) form.append('deckYear', String(info.deckYear));
  if (info.category) form.append('category', info.category);
  form.append('folderPath', info.folderPath);
  form.append('bestOfTheBest', String(info.bestOfTheBest));

  const label = `${rel}  [${info.deckYear ?? 'no year'} · ${info.clientName ?? 'no client'} · ${info.category ?? 'no category'}${info.bestOfTheBest ? ' · Best of the Best' : ''}]`;
  try {
    const res = await fetch(API, { method: 'POST', body: form });
    const body = (await res.json()) as { data?: { slideCount: number; status: string; alreadyUploaded?: boolean; addedDetails?: string[] }; error?: { code: string; message: string } };
    if (body.error?.code === 'DUPLICATE_DECK') {
      tally.skipped++;
      console.log(`SKIP    ${label}\n        ${body.error.message}`);
    } else if (body.data?.alreadyUploaded) {
      tally.updated++;
      console.log(`UPDATE  ${label}\n        Same file as a deck already uploaded. Added: ${body.data.addedDetails?.join(', ')}`);
    } else if (body.error || body.data?.status !== 'ready') {
      tally.failed++;
      console.log(`FAIL    ${label}\n        ${body.error?.message ?? `status ${body.data?.status}`}`);
    } else {
      tally.uploaded++;
      console.log(`OK      ${label}  ${body.data.slideCount} slides`);
    }
  } catch (e) {
    tally.failed++;
    console.log(`FAIL    ${label}\n        Couldn't reach ${base}. Is the app running (npm run dev)? ${(e as Error).message}`);
  }
}

console.log(`\n${tally.uploaded} uploaded, ${tally.updated} filled in from a second copy, ${tally.skipped} already there, ${tally.failed} failed`);
process.exit(tally.failed ? 1 : 0);
