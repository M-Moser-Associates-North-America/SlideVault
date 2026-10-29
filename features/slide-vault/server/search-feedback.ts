import 'server-only';
import { sql } from './db';
import { ServiceError } from './http';

/**
 * "Not relevant" on search results (docs/DECISIONS.md FD-56). Stores the search as normalized words
 * and the slide, never who said it. A slide marked not relevant for a search goes to the end of that
 * search's results, so it is never hidden and the search never finds less.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Team slide, Healthcare!" and "healthcare team slide" are the same search. */
export const searchKey = (query: string) =>
  [...new Set(query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 2))].sort().join(' ').slice(0, 300);

export async function markNotRelevant(body: Record<string, unknown>): Promise<{ query: string; slideId: string; notRelevant: boolean }> {
  const query = typeof body.query === 'string' ? body.query : '';
  const slideId = typeof body.slideId === 'string' ? body.slideId : '';
  const key = searchKey(query);
  if (!key) throw new ServiceError(400, 'BAD_REQUEST', 'Send the search the slide came from as query.');
  if (!UUID.test(slideId)) throw new ServiceError(400, 'BAD_REQUEST', 'Only slides from uploaded decks can be marked.');
  if (typeof body.notRelevant !== 'boolean') throw new ServiceError(400, 'BAD_REQUEST', 'Send notRelevant: true to mark it, or false to undo.');
  const [exists] = await sql<{ n: string }>('select count(*) as n from slides where id = $1', [slideId]);
  if (exists.n === '0') throw new ServiceError(404, 'NOT_FOUND', 'That slide was not found.');
  if (body.notRelevant) {
    await sql(`insert into search_feedback (query_key, slide_id) values ($1, $2)`, [key, slideId]);
  } else {
    // Undo one mark (the latest), so one person's undo doesn't erase everyone's.
    await sql(`delete from search_feedback where id = (select id from search_feedback where query_key = $1 and slide_id = $2 order by created_at desc limit 1)`, [key, slideId]);
  }
  return { query, slideId, notRelevant: body.notRelevant };
}

/** Slides marked not relevant for this search, with how many times. Empty when the database can't be reached. */
export async function notRelevantFor(query: string, slideIds: string[]): Promise<Map<string, number>> {
  const ids = slideIds.filter((id) => UUID.test(id));
  const key = searchKey(query);
  if (!ids.length || !key) return new Map();
  try {
    const rows = await sql<{ slide_id: string; n: string }>(
      `select slide_id::text as slide_id, count(*) as n from search_feedback where query_key = $1 and slide_id = any($2::uuid[]) group by slide_id`,
      [key, ids],
    );
    return new Map(rows.map((r) => [r.slide_id, Number(r.n)]));
  } catch (e) {
    console.error('Search feedback unavailable', e);
    return new Map();
  }
}
