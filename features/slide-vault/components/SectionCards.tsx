'use client';

import { useMemo, useState } from 'react';
import type { SlideSummary } from '../contracts/dto';
import { Icon } from './icons';
import { clientOf, plural, yearOf } from './library';
import { Thumb } from './parts';
import { useWorkspace } from './state';

/**
 * A deck's section as one card (docs/DECISIONS.md FD-57; Alina, 28 Oct: "scroll through these five
 * slides in that section"): the section's cover, its name, how many slides it has, and two actions:
 * open just that section in the preview, or add all of it to the draft deck. The cards are made from
 * the slides in the results, grouped by the section they sit in. When the server can list a whole
 * section, the count and "add all" can cover slides the search words did not match.
 */

export type SectionGroup = { key: string; name: string; deck: string; client: string; year: number | null; cover: SlideSummary; slides: SlideSummary[] };

/** Group results by (deck, section). Needs at least two slides: one slide is just a card. */
export function groupBySection(slides: SlideSummary[]): SectionGroup[] {
  const groups = new Map<string, SlideSummary[]>();
  for (const s of slides) {
    if (!s.section?.dividerId) continue;
    const key = `${s.provenance.sourceId}:${s.section.dividerId}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups]
    .map(([key, list]) => {
      const slides = [...list].sort((a, b) => a.provenance.slideNumber - b.provenance.slideNumber);
      const cover = slides.find((s) => s.section?.divider) ?? slides[0];
      return { key, name: cover.section?.name ?? 'Section', deck: cover.provenance.sourceTitle, client: clientOf(cover), year: yearOf(cover), cover, slides };
    })
    .filter((g) => g.slides.length > 1);
}

const FIRST = 6;

export function SectionCards({ results }: { results: SlideSummary[] }) {
  const { openPreview, selection, updateSelection, announce, toast } = useWorkspace();
  const groups = useMemo(() => groupBySection(results), [results]);
  const [all, setAll] = useState(false);
  if (groups.length === 0) return null;
  const shown = all ? groups : groups.slice(0, FIRST);

  const inDraft = (g: SectionGroup) => g.slides.every((s) => selection.some((x) => x.id === s.id));
  const toggle = (g: SectionGroup) => {
    const ids = new Set(g.slides.map((s) => s.id));
    if (inDraft(g)) {
      updateSelection((cur) => cur.filter((s) => !ids.has(s.id)));
      announce(`Removed ${plural(g.slides.length, 'slide')} of ${g.name} from the draft deck`);
      return;
    }
    const have = new Set(selection.map((s) => s.id));
    const add = g.slides.filter((s) => !have.has(s.id));
    updateSelection((cur) => [...cur, ...g.slides.filter((s) => !cur.some((c) => c.id === s.id))]);
    toast(`Added ${plural(add.length, 'slide')} from ${g.name}`);
    announce(`Added ${plural(add.length, 'slide')} of ${g.name} to the draft deck`);
  };

  return (
    <section className="seccards" aria-label="Sections found">
      <ul className="seccards-list">
        {shown.map((g) => {
          const on = inDraft(g);
          return (
            <li key={g.key} className={`seccard${on ? ' is-in' : ''}`}>
              <button type="button" className="seccard-cover" aria-label={`Open the ${g.name} section of ${g.deck}`} onClick={() => openPreview(g.slides, 0)}>
                <Thumb slide={g.cover} />
              </button>
              <div className="seccard-body">
                <h3 className="seccard-name">{g.name}</h3>
                <p className="seccard-meta">
                  {g.client}
                  {g.year ? ` · ${g.year}` : ''}
                </p>
                <p className="seccard-n">{plural(g.slides.length, 'slide')} in this section</p>
                <div className="seccard-acts">
                  <button type="button" className="btn btn-sm" onClick={() => openPreview(g.slides, 0)}>
                    Open section
                  </button>
                  <button type="button" className={`btn btn-sm${on ? '' : ' btn-primary'}`} aria-pressed={on} onClick={() => toggle(g)}>
                    {on ? (
                      <>
                        <Icon name="check" className="ic-sm" /> In draft deck · Remove
                      </>
                    ) : (
                      <>Add all {g.slides.length} to draft deck</>
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
