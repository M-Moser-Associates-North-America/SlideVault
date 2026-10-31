/**
 * Makes a meaning fingerprint (embedding) for every slide, for meaning search (docs/DECISIONS.md
 * FD-55). Uses the embedding model in .env.local (SV_EMBED_MODEL, SV_EMBED_BASE_URL, SV_EMBED_API_KEY;
 * e.g. a local Ollama with nomic-embed-text, free). Slides already done with the same model and the
 * same words are skipped, so it's safe to run again after uploads or a model change.
 *
 *   npm run embed:slides            # dry run: checks the model answers, counts what would be done
 *   npm run embed:slides -- --yes   # makes and saves the fingerprints
 *
 * What's sent to the model: each slide's title, words and story tags. Nothing else is stored.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { embed, readEmbedConfig, slideEmbedText, sourceHash, toVectorLiteral } from '../features/slide-vault/server/embeddings';

const yes = process.argv.includes('--yes');
const root = path.resolve(import.meta.dirname, '..');
const env: Record<string, string> = {};
const envFile = path.join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
}
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('SV_') && v) env[k] = v;
const config = readEmbedConfig(env);
if (!config) {
  console.error('No embedding model set. Add to .env.local, for example (free, on this computer):\n\n  SV_EMBED_BASE_URL=http://localhost:11434/v1\n  SV_EMBED_MODEL=nomic-embed-text\n\nand run: ollama pull nomic-embed-text');
  process.exit(1);
}

const ssl = env.SV_DB_SSL === 'disable' ? false : env.SV_DB_CA_FILE ? { ca: readFileSync(env.SV_DB_CA_FILE, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
const client = new pg.Client({ host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME || 'postgres', user: env.SV_DB_USER, password: env.SV_DB_PASSWORD, ssl });
await client.connect();
await client.query(`set role slidevault_developer; set search_path to ${pg.escapeIdentifier(env.SV_DB_SCHEMA)}, public, extensions`);
const hasTable = (await client.query(`select 1 from information_schema.tables where table_schema = $1 and table_name = 'slide_embeddings'`, [env.SV_DB_SCHEMA])).rowCount;
if (!hasTable) {
  console.error('The slide_embeddings table isn\'t there yet. Run npm run db:vector first.');
  await client.end();
  process.exit(1);
}

type Row = { id: string; deck_title: string; client: string | null; title: string | null; text: string | null; story_role: string | null; themes: string[] | null; proof_sectors: string[] | null; projects: string[] | null; shows: string | null; convinces: string | null };
const rows = (await client.query<Row>(
  `select s.id, d.title as deck_title, d.client, s.title, s.text, s.story_role, s.themes, s.proof_sectors, s.projects, s.shows, s.convinces
   from slides s join decks d on d.id = s.deck_id where d.status = 'ready' and d.archived_at is null order by d.title, s.slide_number`,
)).rows;
const done = new Map((await client.query<{ slide_id: string; model: string; source_hash: string }>('select slide_id::text as slide_id, model, source_hash from slide_embeddings')).rows.map((r) => [r.slide_id, r]));

const todo = rows
  .map((r) => {
    const text = slideEmbedText({ client: r.client, deckTitle: r.deck_title, title: r.title, text: r.text, role: r.story_role, themes: r.themes, sectors: r.proof_sectors, projects: r.projects, shows: r.shows, convinces: r.convinces });
    return { id: r.id, deck: r.deck_title, text, hash: sourceHash(text, config.model) };
  })
  .filter((r) => { const d = done.get(r.id); return !d || d.model !== config.model || d.source_hash !== r.hash; });

console.log(`${yes ? 'MAKING FINGERPRINTS' : 'DRY RUN: nothing is saved.'} Model: ${config.model} at ${config.baseUrl}`);
console.log(`${rows.length} slide(s) in ready decks; ${rows.length - todo.length} already done with this model; ${todo.length} to do.`);
try {
  const [probe] = await embed(config, ['Meet the team: design lead and project manager.'], 'document');
  console.log(`The model answers: each fingerprint has ${probe.length} numbers.`);
} catch (e) {
  console.error(`The embedding model didn't answer: ${(e as Error).message}\nIs it running? For Ollama: ollama serve, and ollama pull ${config.model}`);
  await client.end();
  process.exit(1);
}

if (!yes) {
  const perDeck = new Map<string, number>();
  for (const t of todo) perDeck.set(t.deck, (perDeck.get(t.deck) ?? 0) + 1);
  for (const [deck, n] of perDeck) console.log(`  ${deck}: ${n}`);
  console.log('\nNothing saved. Add --yes to make them.');
  await client.end();
  process.exit(0);
}

const BATCH = 16;
let saved = 0;
const started = Date.now();
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const vectors = await embed(config, batch.map((b) => b.text), 'document');
  for (const [j, b] of batch.entries()) {
    await client.query(
      `insert into slide_embeddings (slide_id, model, embedding, source_hash) values ($1, $2, $3::vector, $4)
       on conflict (slide_id) do update set model = excluded.model, embedding = excluded.embedding, source_hash = excluded.source_hash, created_at = now()`,
      [b.id, config.model, toVectorLiteral(vectors[j]), b.hash],
    );
  }
  saved += batch.length;
  if (saved % 160 === 0 || saved === todo.length) console.log(`  ${saved} of ${todo.length} (${Math.round((Date.now() - started) / 1000)}s)`);
}
console.log(`\nDone: ${saved} fingerprint(s) saved with ${config.model}. Meaning search is ready once the app has the same SV_EMBED_* settings.`);
await client.end();
