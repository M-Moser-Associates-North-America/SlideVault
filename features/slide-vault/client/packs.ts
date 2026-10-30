import type { SlideSummary } from '../contracts/dto';
import type { LocalPacks } from './pack-store';

/** A pack as the screens use it: the slides that go together, in order, from one deck. */
export type Pack = {
  id: string;
  label: string | null;
  deckId: string;
  status: 'suggested' | 'confirmed';
  /** Who confirmed it and when (ISO date), when known */
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** In the order they belong in. Only slides that exist in the library. */
  slideIds: string[];
  /** True when it exists only in this browser (the server could not store it) */
  local: boolean;
};

export type PacksIndex = { list: Pack[]; of: (slideId: string) => Pack | null };

export const NO_PACKS: PacksIndex = { list: [], of: () => null };

/** Where a slide sits in its pack, 1-based, or 0 when it is in none. */
export const packPosition = (pack: Pack | null, slideId: string) => (pack ? pack.slideIds.indexOf(slideId) + 1 : 0);

/**
 * Every pack from the server (carried on each slide), plus the ones made in this browser. A slide is in
 * at most one pack: the server's wins. Packs with fewer than two slides left are dropped.
 */
export function buildPacks(slides: SlideSummary[], local: LocalPacks, demo = false): PacksIndex {
  const known = new Set(slides.map((s) => s.id));
  const byId = new Map<string, Pack>();
  for (const s of slides) {
    const ref = s.pack;
    if (!ref || byId.has(ref.id) || local.hidden.includes(ref.id)) continue;
    byId.set(ref.id, { id: ref.id, label: ref.label, deckId: s.provenance.sourceId, status: ref.status, confirmedBy: ref.confirmedBy ?? null, confirmedAt: ref.confirmedAt ?? null, slideIds: ref.slideIds.filter((id) => known.has(id)), local: false });
  }
  const taken = new Set<string>();
  const list: Pack[] = [];
  const take = (p: Pack) => {
    if (local.hidden.includes(p.id)) return;
    const ids = p.slideIds.filter((id) => !taken.has(id));
    if (ids.length < 2) return;
    ids.forEach((id) => taken.add(id));
    /* A confirm or unconfirm made in this browser wins until the server stores it. */
    const o = local.status[p.id];
    list.push({ ...p, ...(o ? { status: o.status, confirmedBy: o.by, confirmedAt: o.at } : {}), slideIds: ids });
  };
  byId.forEach(take);
  for (const lp of local.packs) take({ id: lp.id, label: lp.label, deckId: lp.deckId, status: 'confirmed', confirmedBy: null, confirmedAt: null, slideIds: lp.slideIds.filter((id) => known.has(id)), local: true });
  if (demo) for (const p of demoPacks(slides)) take(p);
  const bySlide = new Map<string, Pack>();
  for (const p of list) for (const id of p.slideIds) bySlide.set(id, p);
  return { list, of: (id) => bySlide.get(id) ?? null };
}

/** Pretend packs for showing the screens before the server has any: ?demopacks=1 in the address. */
function demoPacks(slides: SlideSummary[]): Pack[] {
  const decks = new Map<string, SlideSummary[]>();
  for (const s of slides) decks.set(s.provenance.sourceId, [...(decks.get(s.provenance.sourceId) ?? []), s]);
  const big = [...decks.entries()].filter(([, l]) => l.length >= 9).slice(0, 3);
  const out: Pack[] = [];
  big.forEach(([deckId, list], i) => {
    list.sort((a, b) => a.provenance.slideNumber - b.provenance.slideNumber);
    out.push({ id: `demo-${i}-a`, label: ['Team introduction', 'Our approach', 'A project we delivered'][i] ?? null, deckId, status: 'suggested', confirmedBy: null, confirmedAt: null, slideIds: list.slice(0, 5).map((s) => s.id), local: true });
    out.push({ id: `demo-${i}-b`, label: ['Pricing and fees', 'Timeline', 'Results'][i] ?? null, deckId, status: 'confirmed', confirmedBy: null, confirmedAt: null, slideIds: list.slice(5, 9).map((s) => s.id), local: true });
  });
  return out;
}
