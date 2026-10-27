import 'server-only';
import type { PackRef, SlideSummary } from '../contracts/dto';
import { sql, transaction } from './db';
import { ServiceError } from './http';

/**
 * Slide packs: slides that only work together (Grant, 21 Oct; docs/DECISIONS.md FD-38 screens,
 * FD-51 tables, FD-52 these routes). Rules the server keeps, whatever the screen sends:
 *   - 2 to 20 slides, all from the same deck, each slide once;
 *   - a slide is in at most one pack that isn't dismissed (409 otherwise);
 *   - a pack made by a person is confirmed straight away; one from the import or upload is suggested
 *     until someone confirms it, and confirming records who and when;
 *   - dismissing a suggestion keeps it as "dismissed", so it is never suggested again; ungrouping a
 *     pack a person made removes it. Slides are never touched either way.
 * Anyone signed in may do this for the MVP; who may is a tier decision for Alina (hand-off notes).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN = 2;
const MAX = 20;

type PackRow = { id: string; label: string | null; status: 'suggested' | 'confirmed' | 'dismissed'; source: string; confirmed_by: string | null; confirmed_at: Date | null; slide_ids: string[] };
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
const toRef = (p: PackRow): PackRef => ({
  id: p.id,
  label: p.label,
  status: p.status === 'confirmed' ? 'confirmed' : 'suggested',
  confirmedBy: p.confirmed_by,
  confirmedAt: iso(p.confirmed_at),
  slideIds: p.slide_ids,
});

const PACK_SELECT = `select p.id, p.label, p.status, p.source, p.confirmed_by, p.confirmed_at,
    array_agg(m.slide_id::text order by m.position) as slide_ids
  from slide_packs p join slide_pack_members m on m.pack_id = p.id`;

/** The live (not dismissed) pack of each of these slides. Ids that aren't database slides are skipped. */
export async function packsForSlides(slideIds: string[]): Promise<Map<string, PackRef>> {
  const ids = [...new Set(slideIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, PackRef>();
  if (!ids.length) return out;
  const rows = await sql<PackRow>(
    `${PACK_SELECT}
     where p.status <> 'dismissed' and p.id in (select pack_id from slide_pack_members where slide_id = any($1::uuid[]))
     group by p.id`,
    [ids],
  );
  for (const p of rows) for (const sid of p.slide_ids) out.set(sid, toRef(p));
  return out;
}

/** Adds `pack` to every slide that is in one. If the database can't be reached, slides go out as they are. */
export async function withPacks<T extends SlideSummary>(slides: T[]): Promise<T[]> {
  try {
    const packs = await packsForSlides(slides.map((s) => s.id));
    return packs.size ? slides.map((s) => (packs.has(s.id) ? { ...s, pack: packs.get(s.id)! } : s)) : slides;
  } catch (e) {
    console.error('Packs unavailable, slides shown without them', e);
    return slides;
  }
}

async function getPack(id: string): Promise<PackRow | null> {
  if (!UUID.test(id)) return null;
  const [p] = await sql<PackRow>(`${PACK_SELECT} where p.id = $1 group by p.id`, [id]);
  return p ?? null;
}

const cleanLabel = (label: unknown): string | null => {
  if (label === null || label === undefined) return null;
  if (typeof label !== 'string') throw new ServiceError(400, 'BAD_REQUEST', 'label must be text or null.');
  const t = label.trim();
  if (t.length > 80) throw new ServiceError(400, 'BAD_REQUEST', 'Keep the pack name under 80 characters.');
  return t || null;
};

/** POST /packs: a person groups slides. Saved as confirmed, by them. */
export async function createPack(user: string, body: Record<string, unknown>): Promise<PackRef> {
  const raw = body.slideIds;
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) throw new ServiceError(400, 'BAD_REQUEST', 'slideIds must be a list of slide ids, in order.');
  const slideIds = raw as string[];
  if (new Set(slideIds).size !== slideIds.length) throw new ServiceError(400, 'BAD_REQUEST', 'Each slide can be in the pack only once.');
  if (slideIds.length < MIN || slideIds.length > MAX) throw new ServiceError(400, 'BAD_REQUEST', `A pack has ${MIN} to ${MAX} slides.`);
  if (!slideIds.every((id) => UUID.test(id))) throw new ServiceError(400, 'BAD_REQUEST', 'Packs can only use slides from uploaded decks.');
  const label = cleanLabel(body.label);

  return transaction(async (q) => {
    const found = await q<{ id: string; deck_id: string; slide_number: number; title: string | null }>(
      `select id, deck_id, slide_number, title from slides where id = any($1::uuid[]) for update`,
      [slideIds],
    );
    if (found.length !== slideIds.length) throw new ServiceError(404, 'NOT_FOUND', 'One or more of those slides no longer exist.');
    if (new Set(found.map((s) => s.deck_id)).size !== 1) throw new ServiceError(400, 'BAD_REQUEST', 'All slides in a pack must come from the same deck.');
    const taken = await q<{ slide_number: number; title: string | null; label: string | null }>(
      `select s.slide_number, s.title, p.label from slide_pack_members m join slide_packs p on p.id = m.pack_id join slides s on s.id = m.slide_id
       where p.status <> 'dismissed' and m.slide_id = any($1::uuid[]) order by s.slide_number`,
      [slideIds],
    );
    if (taken.length) {
      const which = taken.map((t) => `slide ${t.slide_number}${t.title ? ` ("${t.title}")` : ''}`).join(', ');
      throw new ServiceError(409, 'CONFLICT', `Already in a pack: ${which}. Ungroup that pack first.`);
    }
    const [p] = await q<{ id: string }>(
      `insert into slide_packs (deck_id, label, status, source, created_by, confirmed_by, confirmed_at)
       values ($1, $2, 'confirmed', 'person', $3, $3, now()) returning id`,
      [found[0].deck_id, label, user],
    );
    for (const [i, id] of slideIds.entries()) await q(`insert into slide_pack_members (pack_id, slide_id, position) values ($1, $2, $3)`, [p.id, id, i + 1]);
    const [row] = await q<PackRow>(`${PACK_SELECT} where p.id = $1 group by p.id`, [p.id]);
    return toRef(row);
  });
}

/** PATCH /packs/:id: rename ({ label }) and/or confirm or unconfirm ({ status }). */
export async function updatePack(user: string, id: string, body: Record<string, unknown>): Promise<PackRef | null> {
  const pack = await getPack(id);
  if (!pack || pack.status === 'dismissed') return null;
  const sets: string[] = ['updated_at = now()'];
  const values: unknown[] = [id];
  const add = (v: unknown) => (values.push(v), `$${values.length}`);
  if ('label' in body) sets.push(`label = ${add(cleanLabel(body.label))}`);
  if ('status' in body) {
    if (body.status === 'confirmed') sets.push(`status = 'confirmed'`, `confirmed_by = ${add(user)}`, `confirmed_at = now()`);
    else if (body.status === 'suggested') sets.push(`status = 'suggested'`, `confirmed_by = null`, `confirmed_at = null`);
    else throw new ServiceError(400, 'BAD_REQUEST', "status must be 'confirmed' or 'suggested'.");
  }
  if (sets.length === 1) throw new ServiceError(400, 'BAD_REQUEST', 'Send a label, a status, or both.');
  await sql(`update slide_packs set ${sets.join(', ')} where id = $1`, values);
  const row = await getPack(id);
  return row ? toRef(row) : null;
}

/**
 * DELETE /packs/:id: ungroup. A pack a person made is removed. A suggested one (from the import or an
 * upload) is kept as dismissed, so it isn't suggested again. Slides are never touched.
 */
export async function removePack(user: string, id: string): Promise<{ id: string; dismissed: boolean } | null> {
  const pack = await getPack(id);
  if (!pack || pack.status === 'dismissed') return null;
  if (pack.source === 'person') {
    await sql(`delete from slide_packs where id = $1`, [id]);
    return { id, dismissed: false };
  }
  await sql(`update slide_packs set status = 'dismissed', dismissed_by = $2, dismissed_at = now(), updated_at = now() where id = $1`, [id, user]);
  return { id, dismissed: true };
}
