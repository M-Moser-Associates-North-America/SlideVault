import 'server-only';
import type { ActivityEntry, ActivityKind, Draft } from '../contracts/dto';
import { hasMmoserConfig } from './config';
import { sql } from './db';

/**
 * Per-person data and real usage counts in M Moser's database (docs/DECISIONS.md FD-18; tables in
 * sql/schema.sql). Every per-person function takes the user from principal.ts userOf(), so one
 * person can never read or change another person's rows.
 */

export const ACTIVITY_RETENTION_DAYS = 90;
const ACTIVITY_RETURNED = 200;
const ACTIVITY_KEPT_PER_USER = 1000;
export const LIMITS = { slideId: 200, draftName: 120, draftSlides: 300, drafts: 100, saved: 2000, label: 200 } as const;
export const ACTIVITY_KINDS: readonly ActivityKind[] = ['viewed', 'saved', 'downloaded'];

const ms = (d: Date | string) => new Date(d).getTime();

/* ---- Most downloaded ------------------------------------------------------------------------- */

/** Add one download to each slide (each slide counted once per download, however often listed). */
export async function recordDownloads(slideIds: string[]): Promise<void> {
  const ids = [...new Set(slideIds.filter((id) => typeof id === 'string' && id && id.length <= LIMITS.slideId))];
  if (!ids.length) return;
  await sql(
    `insert into slide_downloads (slide_id, downloads) select unnest($1::text[]), 1
     on conflict (slide_id) do update set downloads = slide_downloads.downloads + 1, last_downloaded_at = now()`,
    [ids],
  );
}

/**
 * Download totals for these slides. Slides never downloaded are left out (read as 0). Returns null
 * when this server has no database, because then the counts are unknown, not zero.
 */
export async function downloadCounts(slideIds: string[]): Promise<Map<string, number> | null> {
  if (!hasMmoserConfig()) return null;
  const ids = [...new Set(slideIds)].filter((id) => id.length <= LIMITS.slideId);
  if (!ids.length) return new Map();
  const rows = await sql<{ slide_id: string; downloads: number }>(`select slide_id, downloads from slide_downloads where slide_id = any($1::text[])`, [ids]);
  return new Map(rows.map((r) => [r.slide_id, r.downloads]));
}

/**
 * Adds `downloads` to each slide. With no database, or a database problem, the slides are left as
 * they were (no `downloads`), so screens can tell "unknown" from "never downloaded".
 */
export async function withDownloadCounts<T extends { id: string; downloads?: number }>(slides: T[], onError?: (e: unknown) => void): Promise<T[]> {
  if (!slides.length) return slides;
  try {
    const counts = await downloadCounts(slides.map((s) => s.id));
    if (!counts) return slides;
    return slides.map((s) => ({ ...s, downloads: counts.get(s.id) ?? 0 }));
  } catch (e) {
    onError?.(e);
    return slides;
  }
}

/* ---- Saved slides ---------------------------------------------------------------------------- */

export async function listSaved(user: string): Promise<string[]> {
  const rows = await sql<{ slide_id: string }>(`select slide_id from saved_slides where user_key = $1 order by saved_at desc limit $2`, [user, LIMITS.saved]);
  return rows.map((r) => r.slide_id);
}

export async function setSaved(user: string, slideId: string, saved: boolean): Promise<void> {
  if (saved) {
    await sql(`insert into saved_slides (user_key, slide_id) values ($1, $2) on conflict do nothing`, [user, slideId]);
  } else {
    await sql(`delete from saved_slides where user_key = $1 and slide_id = $2`, [user, slideId]);
  }
}

/* ---- My decks (drafts) ----------------------------------------------------------------------- */

type DraftRow = { id: string; name: string; slide_ids: string[]; saved_at: Date };
const toDraft = (r: DraftRow): Draft => ({ id: r.id, name: r.name, slideIds: r.slide_ids, savedAt: ms(r.saved_at) });

export async function listDrafts(user: string): Promise<Draft[]> {
  const rows = await sql<DraftRow>(`select id, name, slide_ids, saved_at from drafts where user_key = $1 order by saved_at desc limit $2`, [user, LIMITS.drafts]);
  return rows.map(toDraft);
}

/** Returns null when the person already has the maximum number of drafts. */
export async function createDraft(user: string, name: string, slideIds: string[]): Promise<Draft | null> {
  const rows = await sql<DraftRow>(
    `insert into drafts (user_key, name, slide_ids)
     select $1, $2, $3::text[] where (select count(*) from drafts where user_key = $1) < $4
     returning id, name, slide_ids, saved_at`,
    [user, name, slideIds, LIMITS.drafts],
  );
  return rows[0] ? toDraft(rows[0]) : null;
}

/** true when a draft of this person's was deleted. Another person's draft id simply isn't found. */
export async function deleteDraft(user: string, draftId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return false;
  const rows = await sql<{ id: string }>(`delete from drafts where user_key = $1 and id = $2::uuid returning id`, [user, draftId]);
  return rows.length > 0;
}

/* ---- Opt-in activity ------------------------------------------------------------------------- */

export async function activityOptedIn(user: string): Promise<boolean> {
  const rows = await sql<{ activity_opt_in: boolean }>(`select activity_opt_in from user_settings where user_key = $1`, [user]);
  return rows[0]?.activity_opt_in ?? false;
}

/** Turning tracking off deletes everything recorded for this person, straight away. */
export async function setActivityOptIn(user: string, on: boolean): Promise<void> {
  await sql(
    `insert into user_settings (user_key, activity_opt_in, updated_at) values ($1, $2, now())
     on conflict (user_key) do update set activity_opt_in = excluded.activity_opt_in, updated_at = now()`,
    [user, on],
  );
  if (!on) await sql(`delete from activity_events where user_key = $1`, [user]);
}

/** Deletes everyone's activity older than the retention period. Run on every write, so it never builds up. */
export async function purgeExpiredActivity(): Promise<number> {
  const rows = await sql<{ n: number }>(
    `with gone as (delete from activity_events where at < now() - make_interval(days => $1) returning 1) select count(*)::int as n from gone`,
    [ACTIVITY_RETENTION_DAYS],
  );
  return rows[0]?.n ?? 0;
}

/** Records one event only if this person has opted in. Returns whether it was recorded. */
export async function recordActivity(user: string, kind: ActivityKind, slideId: string | null, label: string): Promise<boolean> {
  const rows = await sql<{ id: string }>(
    `insert into activity_events (user_key, kind, slide_id, label)
     select $1, $2, $3, $4 where exists (select 1 from user_settings where user_key = $1 and activity_opt_in)
     returning id`,
    [user, kind, slideId, label],
  );
  if (!rows.length) return false;
  await purgeExpiredActivity();
  // Keep a person's history bounded: only their most recent events are ever needed for ranking.
  await sql(
    `delete from activity_events where user_key = $1 and id not in (select id from activity_events where user_key = $1 order by at desc, id desc limit $2)`,
    [user, ACTIVITY_KEPT_PER_USER],
  );
  return true;
}

/** This person's activity from the last 90 days, newest first. Empty when they haven't opted in. */
export async function listActivity(user: string): Promise<ActivityEntry[]> {
  const rows = await sql<{ kind: ActivityKind; slide_id: string | null; label: string; at: Date }>(
    `select e.kind, e.slide_id, e.label, e.at from activity_events e
     join user_settings u on u.user_key = e.user_key and u.activity_opt_in
     where e.user_key = $1 and e.at >= now() - make_interval(days => $2)
     order by e.at desc, e.id desc limit $3`,
    [user, ACTIVITY_RETENTION_DAYS, ACTIVITY_RETURNED],
  );
  return rows.map((r) => ({ kind: r.kind, label: r.label, at: ms(r.at), ...(r.slide_id ? { slideId: r.slide_id } : {}) }));
}
