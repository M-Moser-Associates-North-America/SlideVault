import 'server-only';
import type { FreeTag, SlideSummary } from '../contracts/dto';
import { sql } from './db';
import { ServiceError } from './http';

/**
 * Free-form tags (Alina, 21 Oct; docs/DECISIONS.md FD-53): anyone signed in can tag a slide or a
 * whole deck, then filter and sort by it. Kept apart from the story tags the review and the AI give
 * (FD-51). A tag on a deck shows on all of its slides. One copy of a tag per slide or deck, whatever
 * the capitals. Anyone signed in can add or remove for the MVP; who may is a tier decision for Alina.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type TagRow = { id: string; tag: string; target_kind: 'slide' | 'deck'; target_id: string; added_by: string; added_at: Date };
const toTag = (r: TagRow): FreeTag => ({ id: String(r.id), tag: r.tag, on: r.target_kind, addedBy: r.added_by, addedAt: new Date(r.added_at).toISOString() });

/** Adds `tags` to every slide that has any, its own first, then its deck's. Slides go out as they are if the database can't be reached. */
export async function withTags<T extends SlideSummary>(slides: T[]): Promise<T[]> {
  const slideIds = [...new Set(slides.map((s) => s.id).filter((id) => UUID.test(id)))];
  const deckIds = [...new Set(slides.map((s) => s.provenance.sourceId).filter((id) => UUID.test(id)))];
  if (!slideIds.length) return slides;
  try {
    const rows = await sql<TagRow>(
      `select id, tag, target_kind, target_id::text as target_id, added_by, added_at from free_tags
       where (target_kind = 'slide' and target_id = any($1::uuid[])) or (target_kind = 'deck' and target_id = any($2::uuid[]))
       order by lower(tag)`,
      [slideIds, deckIds],
    );
    if (!rows.length) return slides;
    const bySlide = new Map<string, FreeTag[]>(), byDeck = new Map<string, FreeTag[]>();
    for (const r of rows) {
      const map = r.target_kind === 'slide' ? bySlide : byDeck;
      map.set(r.target_id, [...(map.get(r.target_id) ?? []), toTag(r)]);
    }
    return slides.map((s) => {
      const own = bySlide.get(s.id) ?? [];
      const deck = (byDeck.get(s.provenance.sourceId) ?? []).filter((t) => !own.some((o) => o.tag.toLowerCase() === t.tag.toLowerCase()));
      return own.length || deck.length ? { ...s, tags: [...own, ...deck] } : s;
    });
  } catch (e) {
    console.error('Free tags unavailable, slides shown without them', e);
    return slides;
  }
}

/** GET /tags: every tag in use, most used first, for the filter list. */
export async function listTags(): Promise<{ tag: string; slides: number; decks: number }[]> {
  const rows = await sql<{ tag: string; slides: string; decks: string }>(
    `select min(tag) as tag, count(*) filter (where target_kind = 'slide') as slides, count(*) filter (where target_kind = 'deck') as decks
     from free_tags group by lower(tag) order by count(*) desc, lower(min(tag))`,
  );
  return rows.map((r) => ({ tag: r.tag, slides: Number(r.slides), decks: Number(r.decks) }));
}

/** POST /tags { on: 'slide' | 'deck', id, tag }. Adding a tag that's already there returns the existing one. */
export async function addTag(user: string, body: Record<string, unknown>): Promise<FreeTag> {
  const on = body.on;
  const id = body.id;
  if (on !== 'slide' && on !== 'deck') throw new ServiceError(400, 'BAD_REQUEST', "on must be 'slide' or 'deck'.");
  if (typeof id !== 'string' || !UUID.test(id)) throw new ServiceError(400, 'BAD_REQUEST', 'Tags can only go on slides and decks from uploaded decks.');
  if (typeof body.tag !== 'string') throw new ServiceError(400, 'BAD_REQUEST', 'tag must be text.');
  const tag = body.tag.replace(/\s+/g, ' ').trim();
  if (!tag || tag.length > 60) throw new ServiceError(400, 'BAD_REQUEST', 'A tag is 1 to 60 characters.');
  if (/[\u0000-\u001f\u007f]/.test(tag)) throw new ServiceError(400, 'BAD_REQUEST', 'A tag cannot contain control characters.');
  const [exists] = await sql<{ n: string }>(on === 'slide' ? 'select count(*) as n from slides where id = $1' : 'select count(*) as n from decks where id = $1', [id]);
  if (exists.n === '0') throw new ServiceError(404, 'NOT_FOUND', `That ${on} was not found.`);
  const [row] = await sql<TagRow>(
    `with ins as (
       insert into free_tags (target_kind, target_id, tag, added_by) values ($1, $2, $3, $4)
       on conflict (target_kind, target_id, lower(tag)) do nothing
       returning id, tag, target_kind, target_id::text as target_id, added_by, added_at)
     select * from ins
     union all select id, tag, target_kind, target_id::text, added_by, added_at from free_tags
       where target_kind = $1 and target_id = $2 and lower(tag) = lower($3) and not exists (select 1 from ins)`,
    [on, id, tag, user],
  );
  return toTag(row);
}

/** DELETE /tags/:id: removes a tag from its slide or deck. */
export async function removeTag(id: string): Promise<boolean> {
  if (!/^\d{1,18}$/.test(id)) return false;
  const rows = await sql<{ id: string }>('delete from free_tags where id = $1 returning id', [id]);
  return rows.length > 0;
}

/**
 * Tags whose text appears in a search (FD-58), on slides and on decks. The database narrows by
 * substring; the caller keeps whole words only. Empty when the database can't be reached.
 */
export async function tagsInQuery(query: string): Promise<{ tag: string; on: 'slide' | 'deck'; id: string }[]> {
  const q = query.trim().toLowerCase().slice(0, 500);
  if (!q) return [];
  try {
    const rows = await sql<{ tag: string; target_kind: 'slide' | 'deck'; target_id: string }>(
      `select tag, target_kind, target_id::text as target_id from free_tags
       where length(tag) >= 2 and strpos($1, lower(tag)) > 0
       limit 500`,
      [q],
    );
    return rows.map((r) => ({ tag: r.tag, on: r.target_kind, id: r.target_id }));
  } catch (e) {
    console.error('Free tags unavailable, search goes on without them', e);
    return [];
  }
}

/** A tag as people type it: spaces tidied; null when empty, too long or containing control characters. */
export function cleanTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.replace(/\s+/g, ' ').trim();
  return tag && tag.length <= 60 && !/[\u0000-\u001f\u007f]/.test(tag) ? tag : null;
}

/**
 * Tags chosen on the upload page, saved once the deck's slides exist (FD-54): deckTags go on the deck,
 * slideTags on slides by slide number. Tags already there are skipped. Returns how many were saved.
 */
export async function addUploadTags(deckId: string, deckTags: string[], slideTags: Record<string, string[]>, by: string): Promise<number> {
  const slides = await sql<{ id: string; slide_number: number }>('select id, slide_number from slides where deck_id = $1', [deckId]);
  const byNumber = new Map(slides.map((s) => [s.slide_number, s.id]));
  const rows: [string, string, string][] = [];
  for (const t of deckTags.map(cleanTag)) if (t) rows.push(['deck', deckId, t]);
  for (const [n, tags] of Object.entries(slideTags)) {
    const id = byNumber.get(Number(n));
    if (id) for (const t of tags.map(cleanTag)) if (t) rows.push(['slide', id, t]);
  }
  let added = 0;
  for (const [kind, id, tag] of rows) {
    const r = await sql(
      `insert into free_tags (target_kind, target_id, tag, added_by) values ($1, $2, $3, $4)
       on conflict (target_kind, target_id, lower(tag)) do nothing returning id`,
      [kind, id, tag, by],
    );
    added += r.length;
  }
  return added;
}
