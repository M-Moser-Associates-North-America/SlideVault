/**
 * Loads the team's story data into M Moser's Supabase (docs/DECISIONS.md FD-33), so what the
 * storyboard knows about each slide lives in their database, not only on one laptop.
 *
 *   npm run story:import -- --data ~/Desktop/MMoser-RealData                      # dry run: shows what would change
 *   npm run story:import -- --data ~/Desktop/MMoser-RealData --csv <file.csv>     # also slide packs and deck kind, sector, location
 *   npm run story:import -- --data ~/Desktop/MMoser-RealData --csv <file.csv> --yes   # writes it
 *
 * Reads, from the data folder (never the repo: they describe real decks):
 *   slide-metadata.json  reviewed metadata per slide (FD-28): role, type, reuse, flags, themes, sectors, projects
 *   discover-scan.json   the AI's reading of each slide (FD-26): role, topics, shows, convinces, confidence
 *   deck-catalog.json    reviewed client, year and category per deck file
 * and, with --csv, the reviewed metadata sheet for slide packs and deck kind, sector and location.
 *
 * Slides are matched exactly, not by name: the storyboard's slide id is made from the deck file's
 * SHA-256 and the slide number, and Supabase keeps the same SHA-256 for every uploaded deck.
 * PDF decks aren't in Supabase, so their readings are skipped.
 *
 * Reviewed metadata is "confirmed" (a person checked it). The AI's reading alone stays "suggested".
 * Safe to run again: it overwrites the story fields and replaces only packs it imported itself
 * that nobody has confirmed yet. Free tags people added are never touched.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1].replace(/^~(?=$|\/)/, os.homedir()) : undefined;
};
const dataDir = opt('--data');
const csvFile = opt('--csv');
const yes = args.includes('--yes');
if (!dataDir) {
  console.error('Give the folder with the data files, e.g. npm run story:import -- --data ~/Desktop/MMoser-RealData');
  process.exit(1);
}

// ---- reading the files ----------------------------------------------------------------------
const readJson = <T,>(file: string): Record<string, T> => {
  const p = path.join(dataDir, file);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, T>;
};
type MetaRow = { role?: unknown; type?: unknown; reuse?: unknown; flags?: unknown; themes?: unknown; proofSectors?: unknown; projects?: unknown };
type ScanRow = { role?: unknown; topics?: unknown; shows?: unknown; convinces?: unknown; confidence?: unknown };
type CatalogRow = { clientName?: unknown; deckYear?: unknown; category?: unknown; title?: unknown };
const meta = readJson<MetaRow>('slide-metadata.json');
const scan = readJson<ScanRow>('discover-scan.json');
const catalog = readJson<CatalogRow>('deck-catalog.json');
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim()) : typeof v === 'string' && v.trim() ? v.split(';').map((t) => t.trim()).filter(Boolean) : []);

/** Tiny CSV reader: quoted fields, commas and newlines inside quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((f) => f.trim()));
  const keys = (head ?? []).map((h) => h.replace(/^﻿/, '').trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}
const csv = csvFile ? parseCsv(readFileSync(csvFile, 'utf8')) : [];
if (csvFile && !csv.length) {
  console.error(`No rows found in ${csvFile}`);
  process.exit(1);
}

// ---- connecting -----------------------------------------------------------------------------
const env: Record<string, string> = {};
const envFile = path.resolve(import.meta.dirname, '..', '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
}
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('SV_DB_') && v) env[k] = v;
const ssl = env.SV_DB_SSL === 'disable' ? false : env.SV_DB_CA_FILE ? { ca: readFileSync(env.SV_DB_CA_FILE, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
const client = new pg.Client({ host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME || 'postgres', user: env.SV_DB_USER, password: env.SV_DB_PASSWORD, ssl });
await client.connect();
await client.query(`set role slidevault_developer; set search_path to ${pg.escapeIdentifier(env.SV_DB_SCHEMA)}, public`);

const hasColumns = await client.query(`select 1 from information_schema.columns where table_schema = $1 and table_name = 'slides' and column_name = 'story_role'`, [env.SV_DB_SCHEMA]);
if (!hasColumns.rowCount) {
  console.error('The story columns are not in the database yet. Run npm run db:setup first, then this again.');
  await client.end();
  process.exit(1);
}

// ---- matching -------------------------------------------------------------------------------
type Deck = { id: string; title: string; client: string; year: number | null; category: string | null; source_filename: string; file_hash: string; archived_at: Date | null };
type Slide = { id: string; deck_id: string; slide_number: number };
const decks = (await client.query<Deck>('select id, title, client, year, category, source_filename, file_hash, archived_at from decks order by title')).rows;
const slides = (await client.query<Slide>('select id, deck_id, slide_number from slides')).rows;
const slidesByDeck = new Map<string, Slide[]>();
for (const s of slides) slidesByDeck.set(s.deck_id, [...(slidesByDeck.get(s.deck_id) ?? []), s]);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// Same rule as scripts/ingest.mts on the storyboard branch: ver_ + first 16 of the file's SHA-256.
const storyboardId = (fileHash: string, n: number) => `sld_${sha(`ver_${fileHash.slice(0, 16)}:${n}`).slice(0, 16)}`;
const norm = (s: string) => s.toLowerCase().replace(/\.(pptx|pdf)$/i, '').replace(/[^a-z0-9]/g, '');

type SlideUpdate = {
  id: string; role: string | null; reuse: string | null; type: string | null; image: string | null;
  themes: string[]; sectors: string[]; projects: string[]; flags: string[];
  shows: string | null; convinces: string | null; status: 'confirmed' | 'suggested'; uncertain: boolean;
};
const updates: SlideUpdate[] = [];
const report: { deck: Deck; reviewed: number; readOnly: number; slides: number }[] = [];
const usedIds = new Set<string>();
const csvByKey = new Map<string, Record<string, string>>();
for (const r of csv) csvByKey.set(`${norm(r.deck ?? '')}#${Number(r.slide)}`, r);

for (const d of decks) {
  const own = slidesByDeck.get(d.id) ?? [];
  let reviewed = 0, readOnly = 0;
  for (const s of own) {
    const key = storyboardId(d.file_hash, s.slide_number);
    const m = meta[key], r = scan[key];
    const c = csvByKey.get(`${norm(d.source_filename)}#${s.slide_number}`);
    if (!m && !r && !c) continue;
    usedIds.add(key);
    const isReviewed = !!(m && str(m.role)) || !!(c && str(c.reviewed_role));
    if (isReviewed) reviewed++; else readOnly++;
    updates.push({
      id: s.id,
      role: str(m?.role) ?? str(c?.reviewed_role) ?? str(r?.role),
      reuse: str(m?.reuse) ?? str(c?.reuse_status),
      type: str(m?.type) ?? str(c?.reviewed_type),
      image: str(c?.image_kind),
      themes: [...new Set([...list(m?.themes ?? c?.themes), ...(isReviewed ? [] : list(r?.topics))])].slice(0, 12),
      sectors: list(m?.proofSectors ?? c?.proof_sectors),
      projects: list(m?.projects ?? c?.projects),
      flags: list(m?.flags ?? c?.flags),
      shows: str(r?.shows),
      convinces: str(r?.convinces),
      status: isReviewed ? 'confirmed' : 'suggested',
      uncertain: !isReviewed && String(r?.confidence ?? '').startsWith('uncertain'),
    });
  }
  report.push({ deck: d, reviewed, readOnly, slides: own.length });
}

// Deck facts: the catalog by file name, then the CSV's deck-level columns.
type DeckUpdate = { id: string; title: string; client: string | null; year: number | null; category: string | null; kind: string | null; sector: string | null; location: string | null };
const catalogByName = new Map(Object.entries(catalog).map(([k, v]) => [norm(path.basename(k)), v]));
const csvDeck = new Map<string, Record<string, string>>();
for (const r of csv) if (!csvDeck.has(norm(r.deck ?? ''))) csvDeck.set(norm(r.deck ?? ''), r);
const deckUpdates: DeckUpdate[] = [];
for (const d of decks) {
  const cat = catalogByName.get(norm(d.source_filename));
  const row = csvDeck.get(norm(d.source_filename));
  if (!cat && !row) continue;
  const yearNum = Number(cat?.deckYear ?? row?.year);
  deckUpdates.push({
    id: d.id, title: d.title,
    client: str(cat?.clientName) ?? str(row?.client),
    year: Number.isInteger(yearNum) && yearNum > 1950 ? yearNum : null,
    category: str(cat?.category),
    kind: str(row?.deck_kind), sector: str(row?.client_sector), location: str(row?.location),
  });
}

// Slide packs from the CSV: rows sharing a pack number within one deck, in slide order.
type Pack = { deckId: string; deckTitle: string; label: string; slideIds: string[] };
const packs: Pack[] = [];
for (const d of decks) {
  const rows = csv.filter((r) => norm(r.deck ?? '') === norm(d.source_filename) && (r.pack ?? '').trim());
  const bySlide = new Map((slidesByDeck.get(d.id) ?? []).map((s) => [s.slide_number, s.id]));
  const groups = new Map<string, number[]>();
  for (const r of rows) groups.set(r.pack.trim(), [...(groups.get(r.pack.trim()) ?? []), Number(r.slide)]);
  for (const [label, nums] of groups) {
    const ids = nums.sort((a, b) => a - b).map((n) => bySlide.get(n)).filter((x): x is string => !!x);
    if (ids.length >= 2) packs.push({ deckId: d.id, deckTitle: d.title, label: `Pack ${label}`, slideIds: ids });
  }
}

// ---- the report -----------------------------------------------------------------------------
const metaKeys = Object.keys(meta).length, scanKeys = Object.keys(scan).length;
console.log(`${yes ? 'IMPORT' : 'DRY RUN: nothing is changed.'}\n`);
console.log(`Files: ${metaKeys} reviewed slide(s), ${scanKeys} AI reading(s), ${Object.keys(catalog).length} catalog deck(s)${csvFile ? `, ${csv.length} CSV row(s)` : ''}.\n`);
console.log('Decks in Supabase:');
for (const r of report) {
  const what = r.reviewed || r.readOnly ? `${r.reviewed} confirmed, ${r.readOnly} suggested (AI only)` : 'no story data matched';
  console.log(`  ${r.deck.title} (${r.slides} slides)${r.deck.archived_at ? ' [archived]' : ''}: ${what}`);
}
const unusedMeta = Object.keys(meta).filter((k) => !usedIds.has(k)).length;
const unusedScan = Object.keys(scan).filter((k) => !usedIds.has(k)).length;
if (unusedMeta || unusedScan) console.log(`\nNot in Supabase yet (deck not uploaded, or a PDF): ${unusedMeta} reviewed slide(s), ${unusedScan} AI reading(s).`);
if (csvFile) {
  const missing = [...new Set(csv.map((r) => r.deck))].filter((n) => !decks.some((d) => norm(d.source_filename) === norm(n)));
  if (missing.length) console.log(`CSV decks not in Supabase yet: ${missing.join(', ')}`);
}
if (deckUpdates.length) {
  console.log('\nDeck facts to set:');
  for (const u of deckUpdates) console.log(`  ${u.title}: ${[u.client && `client ${u.client}`, u.year && `year ${u.year}`, u.category && `category ${u.category}`, u.kind && `kind "${u.kind}"`, u.sector && `sector ${u.sector}`, u.location && `location ${u.location}`].filter(Boolean).join(', ')}`);
}
console.log(`\n${updates.length} slide(s) get story data; ${packs.length} slide pack(s) suggested.`);

if (!yes) {
  console.log('\nNothing changed. Add --yes to write it.');
  await client.end();
  process.exit(0);
}

// ---- writing --------------------------------------------------------------------------------
try {
  await client.query('begin');
  for (const u of updates) {
    await client.query(
      `update slides set story_role = $2, reuse_status = $3, slide_type = coalesce($4, slide_type), image_kind = $5,
         themes = $6, proof_sectors = $7, projects = $8, flags = $9, shows = $10, convinces = $11,
         story_status = $12, story_confirmed_by = $13, ai_uncertain = $14
       where id = $1`,
      [u.id, u.role, u.reuse, u.type, u.image, u.themes, u.sectors, u.projects, u.flags, u.shows, u.convinces, u.status, u.status === 'confirmed' ? 'team review' : null, u.uncertain],
    );
  }
  for (const u of deckUpdates) {
    await client.query(
      `update decks set client = coalesce($2, client), year = coalesce($3, year), category = coalesce($4, category),
         deck_kind = coalesce($5, deck_kind), client_sector = coalesce($6, client_sector), project_location = coalesce($7, project_location)
       where id = $1`,
      [u.id, u.client, u.year, u.category, u.kind, u.sector, u.location],
    );
  }
  // Decks where someone already confirmed packs keep them as they are; only unconfirmed imported packs are replaced.
  const confirmed = new Set((await client.query<{ deck_id: string }>(`select distinct deck_id from slide_packs where status = 'confirmed'`)).rows.map((r) => r.deck_id));
  const packDecks = [...new Set(packs.map((p) => p.deckId))].filter((id) => !confirmed.has(id));
  if (packDecks.length) await client.query(`delete from slide_packs where source = 'import' and status = 'suggested' and deck_id = any($1::uuid[])`, [packDecks]);
  for (const p of packs.filter((x) => !confirmed.has(x.deckId))) {
    const { rows } = await client.query<{ id: string }>(`insert into slide_packs (deck_id, label) values ($1, $2) returning id`, [p.deckId, p.label]);
    for (const [i, sid] of p.slideIds.entries()) await client.query(`insert into slide_pack_members (pack_id, slide_id, position) values ($1, $2, $3) on conflict do nothing`, [rows[0].id, sid, i + 1]);
  }
  await client.query('commit');
  console.log(`\nDone: ${updates.length} slide(s), ${deckUpdates.length} deck(s), ${packs.length} pack(s).`);
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error('Import failed, nothing was changed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
