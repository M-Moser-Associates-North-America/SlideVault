'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSection, listSections } from '../client/api';
import type { SlideSummary } from '../contracts/dto';
import { Icon } from './icons';
import { clientOf, plural, SECTION_LABEL, slideMatches, yearOf } from './library';
import { Thumb, useAddSection } from './parts';
import { useWorkspace } from './state';

/**
 * A deck's section as one card (docs/DECISIONS.md FD-57, FD-80; Alina, 28 Oct: "scroll through these five
 * slides in that section"): the section's cover, its name, how many slides it has, and two actions: open
 * just that section in the preview, or add all of it to the draft deck.
 *
 * The cards come from two places: the slides a search found, grouped by the section they sit in
 * (SectionCards), or the server's list of one kind of section across every deck, for browsing without a
 * search (SectionBrowse). Either way a card asks the server for its whole section, so the count, Open and
 * "Add all" cover slides the search words did not match; if the server can't answer, a card uses the
 * slides it has.
 */

export type SectionGroup = { key: string; dividerId: string; name: string; deck: string; client: string; year: number | null; cover: SlideSummary; slides: SlideSummary[]; total: number };

const groupOf = (cover: SlideSummary, slides: SlideSummary[], total: number, name?: string): SectionGroup => ({
  key: `${cover.provenance.sourceId}:${cover.section?.dividerId}`,
  dividerId: cover.section?.dividerId ?? '',
  name: name ?? cover.section?.name ?? 'Section',
  deck: cover.provenance.sourceTitle,
  client: clientOf(cover),
  year: yearOf(cover),
  cover,
  slides,
  total,
});

/** Group search results by (deck, section), in the order the search ranked them. By default a section needs at least two of the slides found; `min` 1 gives a card to every section touched (each card fetches its whole section). */
export function groupBySection(slides: SlideSummary[], min = 2): SectionGroup[] {
  const groups = new Map<string, SlideSummary[]>();
  for (const s of slides) {
    if (!s.section?.dividerId) continue;
    const key = `${s.provenance.sourceId}:${s.section.dividerId}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => a.provenance.slideNumber - b.provenance.slideNumber);
      return groupOf(sorted.find((s) => s.section?.divider) ?? sorted[0], sorted, sorted.length);
    })
    .filter((g) => g.slides.length >= min);
}

const FIRST = 6;

/** The cards, and what they do. `groups` are the sections to show; each asks for its whole section once. */
function Cards({ groups }: { groups: SectionGroup[] }) {
  const { runtime, openPreview, selection, updateSelection, announce } = useWorkspace();
  const { addSection } = useAddSection();
  const [all, setAll] = useState(false);
  const [whole, setWhole] = useState<Record<string, SlideSummary[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const firstShown = all ? groups : groups.slice(0, FIRST);
  const wanted = firstShown.map((g) => g.dividerId).join('|');

  useEffect(() => {
    const ctl = new AbortController();
    for (const g of firstShown) {
      if (!g.dividerId || whole[g.dividerId]) continue;
      getSection(runtime, g.dividerId, ctl.signal)
        .then((sec) => { if (sec && sec.slides.length > 0) setWhole((cur) => ({ ...cur, [g.dividerId]: sec.slides })); })
        .catch(() => undefined);
    }
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `whole` only skips what is already here
  }, [wanted, runtime]);

  if (groups.length === 0) return null;
  const slidesOf = async (g: SectionGroup): Promise<SlideSummary[]> => {
    if (whole[g.dividerId]) return whole[g.dividerId];
    const sec = await getSection(runtime, g.dividerId).catch(() => null);
    return sec && sec.slides.length > 0 ? sec.slides : g.slides;
  };
  const countOf = (g: SectionGroup) => whole[g.dividerId]?.length ?? g.total;
  /* The cover is the section's own divider (its title slide): from the whole section once it has arrived, else what the search found. */
  const coverOf = (g: SectionGroup) => { const all = whole[g.dividerId]; return all?.find((x) => x.section?.divider) ?? all?.[0] ?? g.cover; };
  const inDraft = (g: SectionGroup) => !!whole[g.dividerId] && whole[g.dividerId].every((s) => selection.some((x) => x.id === s.id));

  /* The first press of Open or Add all can wait for the section to arrive: say so on the button, and don't take a second press meanwhile. */
  const working = async (g: SectionGroup, run: () => Promise<void>) => {
    if (busy) return;
    setBusy(g.key);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };
  const toggle = async (g: SectionGroup) => {
    const slides = await slidesOf(g);
    const ids = new Set(slides.map((s) => s.id));
    if (slides.every((s) => selection.some((x) => x.id === s.id))) {
      updateSelection((cur) => cur.filter((s) => !ids.has(s.id)));
      announce(`Removed ${plural(slides.length, 'slide')} of ${g.name} from the draft deck`);
      return;
    }
    addSection(g.name, slides);
  };
  const open = async (g: SectionGroup) => {
    const slides = await slidesOf(g);
    const sections = groups.map((x) => ({ key: x.key, name: x.name, dividerId: x.dividerId, slides: x.key === g.key ? slides : (whole[x.dividerId] ?? null) }));
    openPreview(slides, 0, { section: g.name, sections, sectionAt: groups.findIndex((x) => x.key === g.key) });
  };

  return (
    <section className="seccards" aria-label="Sections found">
      <ul className="seccards-list">
        {firstShown.map((g) => {
          const on = inDraft(g);
          const n = countOf(g);
          return (
            <li key={g.key} className={`seccard${on ? ' is-in' : ''}`}>
              <button type="button" className="seccard-cover" aria-label={`Open the ${g.name} section of ${g.deck}`} onClick={() => void working(g, () => open(g))}>
                <Thumb slide={coverOf(g)} />
              </button>
              <div className="seccard-body">
                <h3 className="seccard-name">{g.name}</h3>
                <p className="seccard-meta">
                  {g.client}
                  {g.year ? ` · ${g.year}` : ''}
                </p>
                <p className="seccard-n">{plural(n, 'slide')} in this section</p>
                <div className="seccard-acts">
                  <button type="button" className="btn btn-sm" aria-busy={busy === g.key} disabled={!!busy && busy !== g.key} onClick={() => void working(g, () => open(g))}>
                    Open section
                  </button>
                  <button type="button" className={`btn btn-sm${on ? '' : ' btn-primary'}`} aria-pressed={on} aria-busy={busy === g.key} disabled={!!busy && busy !== g.key} onClick={() => void working(g, () => toggle(g))}>
                    {busy === g.key && !whole[g.dividerId] ? (
                      <>
                        <span className="sv-ring is-small" aria-hidden="true" /> Getting the section…
                      </>
                    ) : on ? (
                      <>
                        <Icon name="check" className="ic-sm" /> In draft deck · Remove
                      </>
                    ) : (
                      <>Add all {n} to draft deck</>
                    )}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {groups.length > FIRST && (
        <button type="button" className="btn-link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer sections' : `Show all ${groups.length} sections`}
        </button>
      )}
    </section>
  );
}

/**
 * Section cards for the slides a search found. Without a heading: nothing when no section has two or more of them.
 * With one (the results page, when sections were asked for): a card for every section touched, and "No sections found."
 * under the heading when there is none, so the slides below are not mistaken for sections.
 */
export function SectionCards({ results, only, heading }: { results: SlideSummary[]; only?: string[]; heading?: string }) {
  const groups = useMemo(() => groupBySection(results, heading ? 1 : 2).filter((g) => !only?.length || only.includes(g.cover.section?.kind ?? '')), [results, only, heading]);
  if (!heading) return <Cards groups={groups} />;
  if (groups.length === 0)
    return (
      <section className="res-block" aria-labelledby="res-sections">
        <h2 className="h2 res-h" id="res-sections">
          {heading}
        </h2>
        <p className="meta" role="status">
          No sections found.
        </p>
      </section>
    );
  return (
    <section className="res-block" aria-labelledby="res-sections">
      <h2 className="h2 res-h" id="res-sections">
        {heading}
      </h2>
      <Cards groups={groups} />
    </section>
  );
}

/** Browse one kind of section across every deck, with no search (the Section filter on Home, FD-80). The other filters still apply. */
export function SectionBrowse({ kind }: { kind: string }) {
  const { runtime, filters } = useWorkspace();
  const [list, setList] = useState<{ kind: string; groups: SectionGroup[] } | 'error' | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    listSections(runtime, kind, ctl.signal)
      .then((rows) => setList(rows ? { kind, groups: rows.map((r) => groupOf(r.cover, [r.cover], r.slideCount, r.name)) } : 'error'))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [runtime, kind]);
  const label = SECTION_LABEL[kind] ?? kind;
  const groups = useMemo(() => (list && list !== 'error' && list.kind === kind ? list.groups.filter((g) => slideMatches(g.cover, filters)) : []), [list, kind, filters]);
  const loaded = list !== null && list !== 'error' && list.kind === kind;
  return (
    <div className="sv-wrap seccards-browse">
      <h2 className="h1">{label}</h2>
      <p className="meta">The {label.toLowerCase()} section of each deck. Open one to scroll through it, or add all of it to your draft deck.</p>
      {list === 'error' && <p role="alert">Sections could not be loaded right now. Please try again.</p>}
      {list === null || (list !== 'error' && list.kind !== kind) ? (
        <div className="sv-loading" role="status">
          <span className="sv-ring" aria-hidden="true" />
          <span>Finding the {label.toLowerCase()} sections…</span>
        </div>
      ) : null}
      {loaded && groups.length === 0 && <p role="status">No {label.toLowerCase()} sections found{filters.client.length || filters.category.length || filters.yfrom !== null || filters.yto !== null ? ' with these filters' : ''}.</p>}
      <Cards groups={groups} />
    </div>
  );
}
