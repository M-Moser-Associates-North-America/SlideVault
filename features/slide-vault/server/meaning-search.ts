import 'server-only';
import type { SlideSummary } from '../contracts/dto';
import { sql } from './db';
import { embed, readEmbedConfig, toVectorLiteral } from './embeddings';
import { getSlideSummariesPg } from './pg-repository';

/**
 * Meaning search (docs/DECISIONS.md FD-55): slides whose meaning fingerprint is closest to the
 * typed words, using pgvector inside M Moser's own database. Returns null, never an error, when it
 * can't run (no embedding model set, pgvector or the table missing, the model not answering), so
 * keyword search always still works.
 */
export type MeaningHit = { slide: SlideSummary; similarity: number };

export async function meaningSearch(query: string, limit: number): Promise<{ model: string; items: MeaningHit[] } | null> {
  const config = readEmbedConfig();
  const q = query.trim();
  if (!config || !q) return null;
  try {
    const [vec] = await embed(config, [q], 'query');
    const rows = await sql<{ slide_id: string; distance: number }>(
      `select e.slide_id::text as slide_id, e.embedding <=> $2::vector as distance
       from slide_embeddings e join slides s on s.id = e.slide_id join decks d on d.id = s.deck_id
       where e.model = $1 and d.status = 'ready' and d.archived_at is null
       order by e.embedding <=> $2::vector limit $3`,
      [config.model, toVectorLiteral(vec), limit],
    );
    const summaries = await getSlideSummariesPg(rows.map((r) => r.slide_id));
    const dist = new Map(rows.map((r) => [r.slide_id, Number(r.distance)]));
    return { model: config.model, items: summaries.map((slide) => ({ slide, similarity: Math.max(0, 1 - (dist.get(slide.id) ?? 1)) })) };
  } catch (e) {
    console.error('Meaning search unavailable, keyword search only', (e as Error).message);
    return null;
  }
}
