import 'server-only';
import { hasMmoserConfig } from './config';
import { sql } from './db';
import { embed, readEmbedConfig, slideEmbedText, sourceHash, toVectorLiteral } from './embeddings';

/**
 * Meaning fingerprints made at upload, and tag suggestions from them (docs/DECISIONS.md FD-82).
 *
 * embedDeck does for one deck what `npm run embed:slides -- --yes` does for the library: right after an
 * upload saves, so a new deck is in meaning search (FD-55) and gets tag suggestions within seconds.
 * Unchanged slides are skipped, like the script. Without an embedding model it does nothing.
 */
const BATCH = 16;
type SlideRow = { id: string; deck_title: string; client: string | null; title: string | null; text: string | null; story_role: string | null; themes: string[] | null; proof_sectors: string[] | null; projects: string[] | null; shows: string | null; convinces: string | null };

export async function embedDeck(deckId: string): Promise<number> {
  const config = readEmbedConfig();
  if (!config || !hasMmoserConfig()) return 0;
  const rows = await sql<SlideRow>(
    `select s.id::text as id, d.title as deck_title, d.client, s.title, s.text, s.story_role, s.themes, s.proof_sectors, s.projects, s.shows, s.convinces
     from slides s join decks d on d.id = s.deck_id where d.id = $1 and d.status = 'ready' and d.archived_at is null order by s.slide_number`,
    [deckId],
  );
  if (!rows.length) return 0;
  const done = new Map((await sql<{ slide_id: string; model: string; source_hash: string }>('select slide_id::text as slide_id, model, source_hash from slide_embeddings where slide_id = any($1::uuid[])', [rows.map((r) => r.id)])).map((r) => [r.slide_id, r]));
  const todo = rows
    .map((r) => {
      const text = slideEmbedText({ client: r.client, deckTitle: r.deck_title, title: r.title, text: r.text, role: r.story_role, themes: r.themes, sectors: r.proof_sectors, projects: r.projects, shows: r.shows, convinces: r.convinces });
      return { id: r.id, text, hash: sourceHash(text, config.model) };
    })
    .filter((r) => { const d = done.get(r.id); return !d || d.model !== config.model || d.source_hash !== r.hash; });
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vectors = await embed(config, batch.map((b) => b.text), 'document');
    for (const [j, b] of batch.entries()) {
      await sql(
        `insert into slide_embeddings (slide_id, model, embedding, source_hash) values ($1, $2, $3::vector, $4)
         on conflict (slide_id) do update set model = excluded.model, embedding = excluded.embedding, source_hash = excluded.source_hash, created_at = now()`,
        [b.id, config.model, toVectorLiteral(vectors[j]), b.hash],
      );
    }
  }
  return todo.length;
}

/** Runs embedDeck without ever failing the caller: an upload is saved whether or not fingerprints can be made. */
export async function embedDeckQuietly(deckId: string): Promise<void> {
  try {
    const n = await embedDeck(deckId);
    if (n) console.warn(`Meaning fingerprints made for ${n} new slide(s).`);
  } catch (e) {
    console.error('Fingerprints for the new deck could not be made now; npm run embed:slides -- --yes does them later.', (e as Error).message);
  }
}

/**
 * Tag suggestions for one slide: the tags of the slides closest to it in meaning. People's own tags
 * (free_tags) and the AI reading's themes and sectors on those neighbours, each weighted by how close
 * the neighbour is, so a word several close slides share ranks first. The reading's themes are written
 * per slide rather than from a fixed list (21 different themes and none shared among one real slide's
 * closest 12, 3 Nov), so one close slide is enough; only tag-like ones (tagLike) are offered, plus the
 * close slides' deck sector. Tags the slide already has are left out. Nothing is saved: a person clicks a suggestion to add it (Alina: AI
 * suggestions stay suggestions until a person confirms). Empty, never an error, when it can't run.
 */
export type TagSuggestion = { tag: string; from: 'people' | 'reading'; score: number };
const NEIGHBOURS = 12;
const MIN_SIMILARITY = Number(process.env.SV_MEANING_MIN_SIMILARITY || 0.55);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Near = { slide_id: string; similarity: number; themes: string[] | null; proof_sectors: string[] | null; tags: string[] | null; client_sector?: string | null };

/**
 * Does a reading word read like a tag? Some themes are headlines copied off the slide ("we listen before we
 * design", real data 3 Nov), which nobody would click: a tag is one to three words, and doesn't open like a sentence.
 */
const SENTENCE_START = /^(we|our|this|that|it|you|your|how|why|what|where|when|the|a|an|is|are)\b/i;
export const tagLike = (t: string) => {
  const words = t.split(' ').filter(Boolean);
  return words.length >= 1 && words.length <= 3 && t.length <= 30 && !SENTENCE_START.test(t) && !/[.!?:;]/.test(t);
};

/** Pure ranking, so it can be checked without a database. */
export function rankTagSuggestions(near: Near[], have: string[], limit = 5): TagSuggestion[] {
  const own = new Set(have.map((t) => t.trim().toLowerCase()));
  const pool = new Map<string, { tag: string; score: number; people: boolean; n: number }>();
  for (const r of near) {
    const sim = Number(r.similarity);
    if (!(sim >= MIN_SIMILARITY)) continue;
    const seen = new Set<string>();
    const add = (raw: string, people: boolean) => {
      const tag = raw.replace(/\s+/g, ' ').trim();
      const key = tag.toLowerCase();
      if (!tag || tag.length > 60 || own.has(key) || seen.has(key)) return;
      seen.add(key);
      const p = pool.get(key) ?? { tag, score: 0, people: false, n: 0 };
      p.score += people ? sim * 1.5 : sim;
      p.people ||= people;
      p.n += 1;
      pool.set(key, p);
    };
    for (const t of r.tags ?? []) add(t, true);
    for (const t of [...(r.themes ?? []), ...(r.proof_sectors ?? []), ...(r.client_sector ? [r.client_sector] : [])]) if (tagLike(t.replace(/\s+/g, ' ').trim())) add(t, false);
  }
  return [...pool.values()]
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map((p) => ({ tag: p.tag, from: p.people ? 'people' : 'reading', score: Math.round(p.score * 100) / 100 }));
}

export async function tagSuggestions(slideId: string, limit = 5): Promise<TagSuggestion[]> {
  if (!UUID.test(slideId) || !hasMmoserConfig()) return [];
  try {
    const near = await sql<Near>(
      `with me as (select embedding, model from slide_embeddings where slide_id = $1::uuid),
       near as (
         select e.slide_id, 1 - (e.embedding <=> me.embedding) as similarity
         from slide_embeddings e cross join me
         join slides s on s.id = e.slide_id join decks d on d.id = s.deck_id
         where e.model = me.model and e.slide_id <> $1::uuid and d.status = 'ready' and d.archived_at is null
         order by e.embedding <=> me.embedding limit $2
       )
       select near.slide_id::text as slide_id, near.similarity, s.themes, s.proof_sectors, d.client_sector,
         (select array_agg(t.tag) from free_tags t where t.target_kind = 'slide' and t.target_id = near.slide_id and t.removed_at is null) as tags
       from near join slides s on s.id = near.slide_id join decks d on d.id = s.deck_id order by near.similarity desc`,
      [slideId, NEIGHBOURS],
    );
    if (!near.length) return [];
    const have = await sql<{ tag: string }>(
      `select t.tag from free_tags t where t.removed_at is null and ((t.target_kind = 'slide' and t.target_id = $1::uuid)
         or (t.target_kind = 'deck' and t.target_id = (select deck_id from slides where id = $1::uuid)))`,
      [slideId],
    );
    return rankTagSuggestions(near, have.map((h) => h.tag), limit);
  } catch (e) {
    console.error('Tag suggestions unavailable right now', (e as Error).message);
    return [];
  }
}
