/**
 * Upload a whole SharePoint-style library folder through POST /uploads, reading year, client,
 * category and Best of the Best from each deck's folder path (features/slide-vault/server/folder-path.ts).
 *
 *   npm run upload:library                                          # the synthetic library, to http://localhost:3000
 *   npm run upload:library -- "<library folder>" --dry-run          # list what WOULD happen; uploads nothing
 *   npm run upload:library -- "<library folder>" --limit 20 --yes   # upload the first 20 decks
 *   npm run upload:library -- "<library folder>" --only Gusto --yes # only decks whose path contains "Gusto"
 *   npm run upload:library -- "<library folder>" --skip Newmark ... # leave out decks whose path contains "Newmark"
 *   npm run upload:library -- "<library folder>" --best-of-the-best # mark every deck as Best of the Best
 *                                                                    # (for a folder that IS that set but isn't named so)
 *   npm run upload:library -- "<library folder>" [base URL] ...
 *
 * Needs the app running (npm run dev) with M Moser's settings in .env.local (except --dry-run).
 * Safe to run twice: a file already uploaded is skipped, or, when it sits in a second folder (a Best of the
 * Best copy of a submittal), the existing deck gets that folder's details added (FD-11).
 *
 * M Moser's bucket can't delete or replace files, so uploads are permanent. For any folder other than
 * the synthetic library, a real upload needs --yes: run --dry-run first and check the list.
 * Never point this at real client decks unless that's been approved (env.example).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { Readable } from 'node:stream';
import { folderInfo } from '../features/slide-vault/server/folder-path';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
if (limitAt >= 0 && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit needs a whole number, e.g. --limit 20');
  process.exit(1);
}
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? (args[onlyAt + 1] ?? '').toLowerCase() : '';
if (onlyAt >= 0 && !only) {
  console.error('--only needs some text from the file or folder name, e.g. --only Gusto');
  process.exit(1);
}
const skipAt = args.indexOf('--skip');
const skip = skipAt >= 0 ? (args[skipAt + 1] ?? '').toLowerCase() : '';
if (skipAt >= 0 && !skip) {
  console.error('--skip needs some text from the file or folder name, e.g. --skip Newmark');
  process.exit(1);
}
const allBotb = flag('--best-of-the-best');
const valueAt = new Set([limitAt, onlyAt, skipAt].filter((i) => i >= 0).map((i) => i + 1));
const positional = args.filter((a, i) => !a.startsWith('--') && !valueAt.has(i));
const SAMPLE = path.join(import.meta.dirname, '../tests/fixtures/sharepoint-library');
const root = path.resolve(positional[0] ?? SAMPLE);
const base = (positional[1] ?? 'http://localhost:3000').replace(/\/$/, '');
const API = `${base}/api/slide-vault/v1/uploads`;
const dryRun = flag('--dry-run');
const isSample = path.relative(path.resolve(SAMPLE), root) === '' || !path.relative(path.resolve(import.meta.dirname, '../tests/fixtures'), root).startsWith('..');
const MAX_BYTES = 2 * 1024 ** 3; // the bucket's limit

const skippedOld: string[] = [];
const walk = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      if (name.startsWith('.') || name.startsWith('~$')) return []; // hidden files and Office lock files
      if (statSync(full).isDirectory()) return walk(full);
      if (name.toLowerCase().endsWith('.pptx')) return [full];
      if (name.toLowerCase().endsWith('.ppt')) skippedOld.push(path.relative(root, full));
      return [];
    });

const found = walk(root).filter((f) => {
  const rel = path.relative(root, f).toLowerCase();
  return (!only || rel.includes(only)) && (!skip || !rel.includes(skip));
});
/** Folder details, plus Best of the Best for every deck when --best-of-the-best is given. */
const detailsOf = (rel: string) => {
  const info = folderInfo(rel);
  return allBotb ? { ...info, bestOfTheBest: true } : info;
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

if (dryRun) {
  console.log(`DRY RUN: nothing is uploaded. ${found.length} .pptx decks found in ${root}${Number.isFinite(limit) ? `; --limit ${limit} would take the first ${Math.min(limit, found.length)}` : ''}\n`);
  const seen = new Map<string, string>();
  const issues = { noYear: 0, noClient: 0, tooBig: 0, sameFile: 0 };
  found.forEach((file, i) => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const info = detailsOf(rel);
    const bytes = statSync(file).size;
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    const notes: string[] = [];
    const note = (kind: keyof typeof issues, text: string) => {
      issues[kind]++;
      notes.push(text);
    };
    if (!info.deckYear) note('noYear', 'no year in the folder path');
    if (!info.clientName) note('noClient', 'no client in the folder path');
    if (bytes > MAX_BYTES) note('tooBig', 'over the 2 GB limit, would fail');
    if (seen.has(hash)) note('sameFile', `same file as #${seen.get(hash)}: details would be added to that deck`);
    else seen.set(hash, String(i + 1));
    const batch = i < limit ? '' : '  (after the --limit, not in this batch)';
    console.log(`${String(i + 1).padStart(3)}. ${rel}  (${mb(bytes)})${batch}\n     -> ${info.deckYear ?? 'no year'} · ${info.clientName ?? 'no client'} · ${info.category ?? 'no category'}${info.bestOfTheBest ? ' · Best of the Best' : ''}${notes.length ? `\n     !  ${notes.join('; ')}` : ''}`);
  });
  if (skippedOld.length) console.log(`\n${skippedOld.length} older .ppt file(s) would be skipped (only .pptx can be split into slides):\n${skippedOld.map((f) => `     ${f}`).join('\n')}`);
  console.log(`\nSummary: ${found.length} decks, ${issues.noYear} without a year, ${issues.noClient} without a client, ${issues.sameFile} duplicate copies, ${issues.tooBig} too big, ${skippedOld.length} .ppt skipped.`);
  console.log('Nothing was uploaded.');
  process.exit(0);
}

if (!isSample && !flag('--yes')) {
  console.error(`Uploads to M Moser's storage are permanent (nothing can be deleted).\nRun with --dry-run first and check the list, then run again with --yes to upload.`);
  process.exit(1);
}

const decks = found.slice(0, limit);
console.log(`Uploading ${decks.length} of ${found.length} decks from ${root}${skippedOld.length ? ` (${skippedOld.length} .ppt skipped)` : ''}\n`);
const tally = { uploaded: 0, updated: 0, skipped: 0, failed: 0 };

for (const file of decks) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const info = detailsOf(rel);
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)]), path.basename(file));
  if (info.clientName) form.append('clientName', info.clientName);
  if (info.deckYear) form.append('deckYear', String(info.deckYear));
  if (info.category) form.append('category', info.category);
  form.append('folderPath', info.folderPath);
  form.append('bestOfTheBest', String(info.bestOfTheBest));

  const label = `${rel}  [${info.deckYear ?? 'no year'} · ${info.clientName ?? 'no client'} · ${info.category ?? 'no category'}${info.bestOfTheBest ? ' · Best of the Best' : ''}]`;
  try {
    const res = await postForm(API, form);
    const body = JSON.parse(res) as { data?: { slideCount: number; status: string; alreadyUploaded?: boolean; addedDetails?: string[] }; error?: { code: string; message: string } };
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

/**
 * POST a form with no time limit. Big decks (hundreds of MB) take longer than the 5 minutes Node's
 * built-in fetch waits for an answer, while the app is still busy storing and splitting them.
 */
function postForm(url: string, form: FormData): Promise<string> {
  const encoded = new Request(url, { method: 'POST', body: form }); // builds the multipart body and its header
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = (target.protocol === 'https:' ? https : http).request(
      target,
      { method: 'POST', headers: { 'content-type': encoded.headers.get('content-type')! }, timeout: 0 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    Readable.fromWeb(encoded.body as import('node:stream/web').ReadableStream).pipe(req);
  });
}
