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
type Slide = { id: string; deck_id: string; slide_number: number; title: string | null; text: string | null };
const decks = (await client.query<Deck>('select id, title, client, year, category, source_filename, file_hash, archived_at from decks order by title')).rows;
const slides = (await client.query<Slide>('select id, deck_id, slide_number, title, text from slides order by deck_id, slide_number')).rows;
const slidesByDeck = new Map<string, Slide[]>();
for (const s of slides) slidesByDeck.set(s.deck_id, [...(slidesByDeck.get(s.deck_id) ?? []), s]);
const deckById = new Map(decks.map((d) => [d.id, d]));

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// Same rule as scripts/ingest.mts on the storyboard branch: ver_ + first 16 of the file's SHA-256.
const storyboardId = (fileHash: string, n: number) => `sld_${sha(`ver_${fileHash.slice(0, 16)}:${n}`).slice(0, 16)}`;
const norm = (s: string) => s.toLowerCase().replace(/\.(pptx|pdf)$/i, '').replace(/[^a-z0-9]/g, '');
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3));

// The CSV belongs to whichever copy of a deck the team read, which may be another version than the
// one in Supabase (slides added or removed). So each CSV row is matched to a slide two ways:
//   1. same file name and the same number of slides: the same version, so slide number = slide number;
//   2. otherwise by the words on the slide: the row's text excerpt against every slide in the decks
//      for that client. A row counts only when one slide clearly fits; image-only slides can't match.
const csvForSlide = new Map<string, Record<string, string>>();
type CsvDeckReport = { name: string; rows: number; byNumber: number; byWords: number; noText: number; into: Map<string, number> };
const csvReport: CsvDeckReport[] = [];
const csvGroups = new Map<string, Record<string, string>[]>();
for (const r of csv) csvGroups.set(r.deck ?? '', [...(csvGroups.get(r.deck ?? '') ?? []), r]);
const loose = (a: string, b: string) => { const x = norm(a), y = norm(b); return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)); };

for (const [name, rows] of csvGroups) {
  const rep: CsvDeckReport = { name, rows: rows.length, byNumber: 0, byWords: 0, noText: 0, into: new Map() };
  csvReport.push(rep);
  const maxSlide = Math.max(...rows.map((r) => Number(r.slide) || 0));
  const same = decks.find((d) => norm(d.source_filename) === norm(name) && (slidesByDeck.get(d.id) ?? []).length === maxSlide);
  if (same) {
    const bySlide = new Map((slidesByDeck.get(same.id) ?? []).map((s) => [s.slide_number, s]));
    for (const r of rows) {
      const s = bySlide.get(Number(r.slide));
      if (s && !csvForSlide.has(s.id)) { csvForSlide.set(s.id, r); rep.byNumber++; rep.into.set(same.id, (rep.into.get(same.id) ?? 0) + 1); }
    }
    continue;
  }
  const client = rows[0]?.client ?? '';
  const candidates = decks.filter((d) => norm(d.source_filename) === norm(name) || loose(client, d.client) || loose(client, d.title)).flatMap((d) => slidesByDeck.get(d.id) ?? []);
  const slideWords = new Map(candidates.map((s) => [s.id, words(`${s.title ?? ''} ${s.text ?? ''}`)]));
  for (const r of rows) {
    const e = words(r.text_excerpt ?? '');
    if (e.size < 5) { rep.noText++; continue; }
    const scored = candidates.map((s) => { const w = slideWords.get(s.id)!; let hit = 0; for (const x of e) if (w.has(x)) hit++; return { s, score: hit / e.size }; }).sort((x, y) => y.score - x.score);
    const [best, second] = scored;
    if (!best || best.score < 0.85 || (second && second.score > best.score - 0.1) || csvForSlide.has(best.s.id)) continue;
    csvForSlide.set(best.s.id, r);
    rep.byWords++;
    rep.into.set(best.s.deck_id, (rep.into.get(best.s.deck_id) ?? 0) + 1);
  }
}

type SlideUpdate = {
  id: string; role: string | null; reuse: string | null; type: string | null; image: string | null;
  themes: string[]; sectors: string[]; projects: string[]; flags: string[];
  shows: string | null; convinces: string | null; status: 'confirmed' | 'suggested'; uncertain: boolean;
};
const updates: SlideUpdate[] = [];
const report: { deck: Deck; reviewed: number; readOnly: number; slides: number }[] = [];
const usedIds = new Set<string>();

for (const d of decks) {
  const own = slidesByDeck.get(d.id) ?? [];
  let reviewed = 0, readOnly = 0;
  for (const s of own) {
    const key = storyboardId(d.file_hash, s.slide_number);
    const m = meta[key], r = scan[key];
    const c = csvForSlide.get(s.id);
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

// Deck facts: the catalog by file name, then the CSV's deck-level columns, taken only when most of
// that CSV deck's text slides were found in this Supabase deck.
type DeckUpdate = { id: string; title: string; client: string | null; year: number | null; category: string | null; kind: string | null; sector: string | null; location: string | null };
const catalogByName = new Map(Object.entries(catalog).map(([k, v]) => [norm(path.basename(k)), v]));
const csvDeckFor = new Map<string, Record<string, string>>();
for (const rep of csvReport) {
  for (const [deckId, n] of rep.into) if (n >= Math.max(5, (rep.rows - rep.noText) / 2)) csvDeckFor.set(deckId, csvGroups.get(rep.name)![0]);
}
const deckUpdates: DeckUpdate[] = [];
for (const d of decks) {
  const cat = catalogByName.get(norm(d.source_filename));
  const row = csvDeckFor.get(d.id);
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

// Slide packs from the CSV: rows sharing a pack number, kept when all their matched slides sit in
// one Supabase deck, in that deck's slide order.
type Pack = { deckId: string; deckTitle: string; label: string; slideIds: string[] };
const packs: Pack[] = [];
const slideById = new Map(slides.map((s) => [s.id, s]));
const packGroups = new Map<string, Slide[]>();
for (const [slideId, r] of csvForSlide) {
  if (!(r.pack ?? '').trim()) continue;
  const k = `${r.deck}#${r.pack.trim()}`;
  packGroups.set(k, [...(packGroups.get(k) ?? []), slideById.get(slideId)!]);
}
for (const [k, members] of packGroups) {
  const deckIds = new Set(members.map((m) => m.deck_id));
  if (members.length < 2 || deckIds.size !== 1) continue;
  const d = deckById.get(members[0].deck_id)!;
  packs.push({ deckId: d.id, deckTitle: d.title, label: `Pack ${k.split('#').pop()}`, slideIds: members.sort((a, b) => a.slide_number - b.slide_number).map((m) => m.id) });
}

// ---- the report -----------------------------------------------------------------------------
const metaKeys = Object.keys(meta).length, scanKeys = Object.keys(scan).length;
console.log(`${yes ? 'IMPORT' : 'DRY RUN: nothing is changed.'}\n`);
console.log(`Files: ${metaKeys} reviewed slide(s), ${scanKeys} AI reading(s), ${Object.keys(catalog).length} catalog deck(s)${csvFile ? `, ${csv.length} CSV row(s)` : ''}.\n`);
if (csvFile) {
  console.log('The CSV, deck by deck (which slides were found in Supabase):');
  for (const rep of csvReport) {
    const where = [...rep.into].map(([id, n]) => `${n} in ${deckById.get(id)?.title}`).join('; ');
    const how = rep.byNumber ? 'same version, matched by slide number' : 'different version or name, matched by the words on each slide';
    const lost = rep.rows - rep.byNumber - rep.byWords;
    console.log(`  ${rep.name} (${rep.rows} slides): ${rep.byNumber + rep.byWords} found${where ? ` (${where})` : ''}${rep.byNumber + rep.byWords ? `, ${how}` : ''}${lost ? `; ${lost} not found${rep.noText ? `, of which ${rep.noText} have too few words to match` : ''}` : ''}`);
  }
  console.log('');
}
console.log('Decks in Supabase:');
for (const r of report) {
  const what = r.reviewed || r.readOnly ? `${r.reviewed} confirmed, ${r.readOnly} suggested (AI only)` : 'no story data matched';
  console.log(`  ${r.deck.title} (${r.slides} slides)${r.deck.archived_at ? ' [archived]' : ''}: ${what}`);
}
const unusedMeta = Object.keys(meta).filter((k) => !usedIds.has(k)).length;
const unusedScan = Object.keys(scan).filter((k) => !usedIds.has(k)).length;
if (unusedMeta || unusedScan) console.log(`\nNot in Supabase (deck not uploaded, another version, or a PDF): ${unusedMeta} reviewed slide(s), ${unusedScan} AI reading(s) from the JSON files.`);
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
