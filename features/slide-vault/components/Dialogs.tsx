'use client';

import { PreviewActions, ShareIconButton } from './SlideActions';
import { PreviewTags } from './TagBits';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { exportPptx, getSection } from '../client/api';
import type { SlideSummary } from '../contracts/dto';
import { useEdgeFade } from './edge-fade';
import { Icon } from './icons';
import { categoryOf, clientOf, downloadPlan, plural, planSummary, yearOf } from './library';
import { Link, Thumb, useAddSection, useCartToggle, useSavedToggle } from './parts';
import { useWorkspaceCompact } from './size';
import { useWorkspace } from './state';

/** Open and close a native <dialog> from React state. Escape closes it (via the dialog's own close event). */
export function useDialogOpen(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [ref, open]);
}

/** A click on the backdrop (the dialog element itself) closes it. */
export const backdropClose = (onClose: () => void) => (e: MouseEvent<HTMLDialogElement>) => {
  if (e.target === e.currentTarget) onClose();
};

/** Large preview of a slide. The side arrows, the filmstrip and swipes walk the slide's own deck; a separate bar steps through the search results it was opened from. */
export function Lightbox() {
  const compactNow = useWorkspaceCompact();
  /* Tablets and desktop share the arrows-on-the-picture layout; only a phone held upright differs. */
  const onTablet = !compactNow;
  const { runtime, library, preview, closePreview, movePreview, goToPreview, openPreview, openDownload, packs, selection, addPackToDraft } = useWorkspace();
  const { isSelected, setOne } = useCartToggle();
  const { addSection } = useAddSection();
  const { isSaved, toggle: toggleSave } = useSavedToggle();
  const { openAlso } = useWorkspace();
  const [zoomed, setZoomed] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  useDialogOpen(ref, !!preview);

  /* A slide picked inside the deck replaces the result's slide until the person steps to another result. */
  const [pick, setPick] = useState<{
    list: SlideSummary[];
    index: number;
    slide: SlideSummary;
  } | null>(null);
  const picked = preview && pick && pick.list === preview.list && pick.index === preview.index ? pick.slide : null;
  const slide = preview ? (picked ?? preview.list[preview.index]) : null;

  const deck = slide && library.status === 'ready' ? library.decks.find((d) => d.id === slide.provenance.sourceId) : undefined;
  const sibs = deck?.slides ?? [];
  const di = slide ? sibs.findIndex((s) => s.id === slide.id) : -1;
  /* Results bar only when the list is a real search, not just this deck's own slides. */
  const fromDeck = !!preview && sibs.length === preview.list.length && preview.list.every((s, k) => s.id === sibs[k].id);
  /* One whole deck section (FD-80): counted "1 of 8 in section", its slides outlined in the film strip,
     while the arrows, the keys and the strip still walk the whole deck. */
  const section = preview?.section ?? null;
  const results = !!preview && preview.list.length > 1 && (!fromDeck || !!section);
  const inSection = (id: string) => !!preview && preview.list.some((x) => x.id === id);
  const sectionAt = section && slide && preview ? preview.list.findIndex((x) => x.id === slide.id) : -1;
  /* The deck's slides in order, with each unbroken run of the section's slides gathered into one part (to be framed). */
  const stripParts: { key: string; inSection: boolean; slides: { s: SlideSummary; k: number }[] }[] = [];
  sibs.forEach((s, k) => {
    const inS = !!section && inSection(s.id);
    const last = stripParts[stripParts.length - 1];
    if (last && last.inSection === inS && inS) last.slides.push({ s, k });
    else if (!inS) stripParts.push({ key: s.id, inSection: false, slides: [{ s, k }] });
    else stripParts.push({ key: s.id, inSection: true, slides: [{ s, k }] });
  });

  const moveDeck = (delta: -1 | 1) => {
    const target = sibs[di + delta];
    if (preview && target) setPick({ list: preview.list, index: preview.index, slide: target });
  };
  const jumpDeck = (index: number) => {
    const target = sibs[index];
    if (preview && target) setPick({ list: preview.list, index: preview.index, slide: target });
  };
  const jumpResult = (index: number) => {
    setPick(null);
    goToPreview(index);
  };
  /* Section results: Previous / Next result (and the [ ] keys) go to the neighbouring section of the search or the Section page, as
     they go to the neighbouring slide of a search; the arrows and the strip walk the whole deck. */
  const [moving, setMoving] = useState(false);
  const sectionTo = async (delta: -1 | 1) => {
    if (!preview?.sections || moving) return;
    const to = (preview.sectionAt ?? 0) + delta;
    const next = preview.sections[to];
    if (!next) return;
    setMoving(true);
    try {
      const slides = next.slides ?? (await getSection(runtime, next.dividerId).catch(() => null))?.slides ?? null;
      if (!slides || slides.length === 0) return;
      const sections = preview.sections.map((x, k) => (k === to ? { ...x, slides } : x));
      setPick(null);
      openPreview(slides, 0, { section: next.name, sections, sectionAt: to });
    } finally {
      setMoving(false);
    }
  };
  const moveResult = (delta: -1 | 1) => {
    if (section) return void sectionTo(delta);
    if (preview && preview.index + delta >= 0 && preview.index + delta < preview.list.length) movePreview(delta);
  };
  const atFirstResult = !preview || preview.index === 0;
  const atLastResult = !preview || preview.index === preview.list.length - 1;
  const sectionFirst = !preview?.sections || (preview.sectionAt ?? 0) <= 0 || moving;
  const sectionLast = !preview?.sections || (preview.sectionAt ?? 0) >= preview.sections.length - 1 || moving;
  /* The rest of the deck comes with the library; until it has arrived, say so instead of showing nothing. */
  const deckLoading = !!section && library.status === 'loading';

  /* Remember the slide we came from so it slides out while the next slides in (same motion as the slide page). */
  const [seen, setSeen] = useState<{
    slide: SlideSummary | null;
    index: number;
    from: SlideSummary | null;
    dir: 'next' | 'prev' | null;
  }>({ slide: null, index: 0, from: null, dir: null });
  if (slide && preview && seen.slide?.id !== slide.id) {
    const prev = seen.slide;
    const prevAt = prev ? sibs.findIndex((s) => s.id === prev.id) : -1;
    const dir = !prev ? null : prevAt >= 0 && di >= 0 ? (di > prevAt ? 'next' : 'prev') : preview.index === seen.index ? null : preview.index > seen.index ? 'next' : 'prev';
    setSeen({ slide, index: preview.index, from: dir ? prev : null, dir });
  } else if (!preview && seen.slide) {
    setSeen({ slide: null, index: 0, from: null, dir: null });
  }
  const preview_img = (sl: SlideSummary) => <PreviewPicture key={sl.id} src={runtime.assetUrl(sl.previewPath)} alt={sl === slide ? sl.title : ''} />;

  /* Keep the current slide in view in the filmstrip. */
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [slide?.id]);

  const where = di >= 0 ? `Slide ${di + 1} of ${sibs.length} in this deck` : `Slide ${slide?.provenance.slideNumber ?? ''}`;

  return (
    <dialog
      ref={ref}
      className="slidevault sv-dialog wide"
      data-theme={runtime.theme}
      aria-labelledby="sv-lb-title"
      onClose={closePreview}
      onClick={backdropClose(closePreview)}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const back = e.key === 'ArrowLeft' || e.key === '[';
        const fwd = e.key === 'ArrowRight' || e.key === ']';
        if (!back && !fwd) return;
        e.preventDefault();
        const delta = back ? -1 : 1;
        if (e.shiftKey || e.key === '[' || e.key === ']') moveResult(delta);
        else moveDeck(delta);
      }}
    >
      {slide && preview && (
        <>
          <div className="dlg-head lb-head">
            {results && (
              <button type="button" className="btn btn-ghost btn-icon btn-sm lb-rnav" aria-label="Previous result" disabled={section ? sectionFirst : atFirstResult} onClick={() => moveResult(-1)}>
                <Icon name="left" />
              </button>
            )}
            <div className="lb-title">
              <h2 id="sv-lb-title">
                <Link className="lb-title-link" to={{ view: 'slide', id: slide.id }} onNavigate={closePreview} title="Open the slide page">
                  {slide.title}
                </Link>
              </h2>
              <ScrollLine key={slide.id}>
                {slide.provenance.sourceTitle} · slide {slide.provenance.slideNumber}
                {slide.hiddenInSource ? ' · hidden in source' : ''}
              </ScrollLine>
            </div>
            {results && (
              <button type="button" className="btn btn-ghost btn-icon btn-sm lb-rnav" aria-label="Next result" disabled={section ? sectionLast : atLastResult} onClick={() => moveResult(1)}>
                <Icon name="right" />
              </button>
            )}
            <div className="dlg-head-tools">
              {slide.alsoIn && (
                <button type="button" className="btn btn-ghost btn-sm lb-also-chip" aria-label={`Also in ${plural(slide.alsoIn.otherDeckCount, 'other deck')}`} data-tip={`Also in ${plural(slide.alsoIn.otherDeckCount, 'other deck')}`} onClick={() => openAlso(slide)}>
                  <Icon name="folders" />
                  <span aria-hidden="true">{slide.alsoIn.otherDeckCount}</span>
                </button>
              )}
              <button
                type="button"
                className={`btn btn-ghost btn-icon btn-sm lb-save${isSaved(slide.id) ? ' is-saved' : ''}`}
                aria-pressed={isSaved(slide.id)}
                aria-label={isSaved(slide.id) ? `Remove from saved: ${slide.title}` : `Save: ${slide.title}`}
                onClick={() => toggleSave(slide)}
              >
                <Icon name="heart" />
              </button>
              <ShareIconButton slideId={slide.id} />
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close preview" onClick={closePreview}>
                <Icon name="x" />
              </button>
            </div>
          </div>
          <div className="dlg-body">
            {results && (
              <div className="lb-results" role="group" aria-label={section ? `${section} section` : 'Search results'}>
                <button type="button" className="btn btn-sm" disabled={section ? sectionFirst : atFirstResult} onClick={() => moveResult(-1)} title="Previous result ( [ or Shift+←)">
                  <Icon name="left" />
                  <span>Previous result</span>
                </button>
                <span className="counter" aria-live="polite">
                  {section ? (
                    sectionAt >= 0 ? (
                      <>
                        <strong>
                          <NumberJump value={sectionAt + 1} max={preview.list.length} label="Go to a slide in this section" onGo={jumpResult} /> of {preview.list.length} in section
                        </strong>
                        {` · ${section}`}
                        {preview.sections && preview.sections.length > 1 && <span className="lb-of"> · result {(preview.sectionAt ?? 0) + 1} of {preview.sections.length}</span>}
                      </>
                    ) : (
                      `Not in the ${section} section`
                    )
                  ) : (
                    <>
                      Result <NumberJump value={preview.index + 1} max={preview.list.length} label="Go to a result" onGo={jumpResult} /> of {preview.list.length}
                    </>
                  )}
                </span>
                {picked && preview && picked.id !== preview.list[preview.index].id && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPick(null)}>
                    {section ? 'Back to the section' : 'Back to the result'}
                  </button>
                )}
                <button type="button" className="btn btn-sm" disabled={section ? sectionLast : atLastResult} onClick={() => moveResult(1)} title="Next result ( ] or Shift+→)">
                  <span>Next result</span>
                  <Icon name="right" />
                </button>
              </div>
            )}
            {/* Phone held upright: the title sits under the result arrows, in the scrolling part. The header's own copy (read by screen readers) is hidden there. */}
            <div className="lb-title lb-title-body" aria-hidden="true">
              <p className="lb-title-text">
                <Link className="lb-title-link" to={{ view: 'slide', id: slide.id }} onNavigate={closePreview} tabIndex={-1}>
                  {slide.title}
                </Link>
              </p>
              <p className="meta">
                {slide.provenance.sourceTitle} · slide {slide.provenance.slideNumber}
                {slide.hiddenInSource ? ' · hidden in source' : ''}
              </p>
            </div>
            <div className="lb-row" data-tablet={onTablet ? '' : undefined} data-handheld="">
              {sibs.length > 1 && (
                <button type="button" className="btn btn-icon lb-nav lb-prev" aria-label="Previous slide in this deck" data-tip="Previous in deck" disabled={di <= 0} onClick={() => moveDeck(-1)}>
                  <Icon name="left" />
                </button>
              )}
              <div
                className="lb-stage"
                onTouchStart={(e) =>
                  (touch.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                  })
                }
                onTouchEnd={(e) => {
                  const t = touch.current;
                  touch.current = null;
                  if (!t) return;
                  const dx = e.changedTouches[0].clientX - t.x;
                  const dy = e.changedTouches[0].clientY - t.y;
                  if (Math.abs(dx) > 50 && Math.abs(dy) < 40) return moveDeck(dx < 0 ? 1 : -1);
                  /* Two quick taps on the slide open it full screen, to zoom in. */
                  if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
                    const now = Date.now();
                    if (now - lastTap.current < 320) {
                      lastTap.current = 0;
                      setZoomed(true);
                    } else lastTap.current = now;
                  }
                }}
                onMouseDown={(e) => {
                  if (e.button === 0) mouse.current = { x: e.clientX, y: e.clientY };
                }}
                onMouseUp={(e) => {
                  const m = mouse.current;
                  mouse.current = null;
                  if (!m) return;
                  const dx = e.clientX - m.x;
                  const dy = e.clientY - m.y;
                  /* Click and drag sideways with a mouse to walk the deck, like a swipe on a touch screen. */
                  if (Math.abs(dx) > 50 && Math.abs(dy) < 60) {
                    dragged.current = true;
                    moveDeck(dx < 0 ? 1 : -1);
                  }
                }}
                onMouseLeave={() => (mouse.current = null)}
                onDragStart={(e) => e.preventDefault()}
                onClickCapture={(e) => {
                  if (dragged.current) {
                    dragged.current = false;
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onDoubleClick={() => setZoomed(true)}
              >
                {seen.from && seen.dir && (
                  <div key={`out-${seen.from.id}`} className={`slide-layer slide-out-${seen.dir}`} aria-hidden="true">
                    {preview_img(seen.from)}
                  </div>
                )}
                <div key={slide.id} className={`slide-layer${seen.dir ? ` slide-in-${seen.dir}` : ''}`}>
                  {preview_img(slide)}
                </div>
                <button type="button" className="lb-zoom" aria-label="View the slide full screen, to zoom in" onClick={() => setZoomed(true)} />
              </div>
              {sibs.length > 1 && (
                <span className="lb-where">
                  {di >= 0 ? (
                    <>
                      <NumberJump value={di + 1} max={sibs.length} label="Go to a slide in this deck" onGo={jumpDeck} />
                      <span className="w-short">/{sibs.length} in deck</span>
                    </>
                  ) : (
                    `Slide ${slide.provenance.slideNumber}`
                  )}
                </span>
              )}
              {sibs.length > 1 && (
                <button
                  type="button"
                  className="btn btn-icon lb-nav lb-next"
                  aria-label="Next slide in this deck"
                  data-tip="Next in deck"
                  disabled={di < 0 || di >= sibs.length - 1}
                  onClick={() => moveDeck(1)}
                >
                  <Icon name="right" />
                </button>
              )}
            </div>
            {deckLoading && sibs.length <= 1 && (
              <div className="sv-loading" role="status">
                <span className="sv-ring is-small" aria-hidden="true" />
                <span>Loading the whole deck…</span>
              </div>
            )}
            {sibs.length > 1 && (
              <div className="lb-deck">
                <p className="lb-deck-label" id="sv-lb-deck">
                  Scroll the deck
                  {section && (
                    <span className="lb-legend">
                      <span className="lb-swatch" aria-hidden="true" />
                      {preview.list.length} slides of {section}
                    </span>
                  )}
                </p>
                <div className="lb-strip" ref={strip} role="group" aria-labelledby="sv-lb-deck">
                  {stripParts.map((part) => {
                    const thumbs = part.slides.map(({ s, k }) => (
                      <button
                        key={s.id}
                        type="button"
                        className="lb-thumb"
                        aria-current={s.id === slide.id ? 'true' : undefined}
                        aria-label={`Slide ${k + 1}: ${s.title}`}
                        onClick={() => {
                          const at = section ? preview.list.findIndex((x) => x.id === s.id) : -1;
                          if (at >= 0) {
                            setPick(null);
                            goToPreview(at);
                          } else setPick({ list: preview.list, index: preview.index, slide: s });
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={runtime.assetUrl(s.previewPath)} alt="" loading="lazy" />
                      </button>
                    ));
                    /* One orange frame round the run of slides that are the section, not an outline on each. */
                    return part.inSection ? (
                      <div key={part.key} className="lb-frame" role="group" aria-label={`${section} section, ${part.slides.length} slides`}>
                        {thumbs}
                      </div>
                    ) : (
                      thumbs
                    );
                  })}
                </div>
              </div>
            )}
            <PreviewActions key={slide.id} slide={slide} />
            <PreviewTags slide={slide} onNavigate={closePreview} />
            <div className="lb-caption">
              <span className={`counter${sibs.length > 1 ? ' is-dup' : ''}`} aria-live="polite">
                {di >= 0 && sibs.length > 1 ? (
                  <>
                    <NumberJump value={di + 1} max={sibs.length} label="Go to a slide in this deck" onGo={jumpDeck} />
                    <span className="w-short">/{sibs.length} in deck</span>
                  </>
                ) : (
                  where
                )}
              </span>
              <span className="row-flex">
                <button type="button" className="btn btn-sm" aria-pressed={isSelected(slide.id)} onClick={() => setOne(slide, !isSelected(slide.id))}>
                  <Icon name="check" />
                  <span className="lbl-long">{section ? (isSelected(slide.id) ? 'Slide in deck' : 'Add slide to deck') : isSelected(slide.id) ? 'In draft deck' : 'Add to draft deck'}</span>
                  <span className="lbl-short" aria-hidden="true">{isSelected(slide.id) ? 'In deck' : 'Add'}</span>
                </button>
                {section && preview && preview.list.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-sm lb-section"
                    disabled={preview.list.every((x) => selection.some((y) => y.id === x.id))}
                    onClick={() => addSection(section, preview.list)}
                  >
                    <Icon name="check" />
                    <span className="lbl-long">{preview.list.every((x) => selection.some((y) => y.id === x.id)) ? 'Section in deck' : `Add section to deck (${preview.list.length})`}</span>
                    <span className="lbl-short" aria-hidden="true">Section ({preview.list.length})</span>
                  </button>
                )}
                {packs.of(slide.id) && (
                  <button
                    type="button"
                    className="btn btn-sm lb-pack"
                    disabled={packs.of(slide.id)!.slideIds.every((id) => selection.some((x) => x.id === id))}
                    onClick={() => addPackToDraft(packs.of(slide.id)!)}
                  >
                    <Icon name="plus" />
                    <span className="lbl-long">Add whole pack ({packs.of(slide.id)!.slideIds.length})</span>
                    <span className="lbl-short" aria-hidden="true">Pack ({packs.of(slide.id)!.slideIds.length})</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    closePreview();
                    openDownload([slide]);
                  }}
                >
                  <Icon name="download" />
                  <span className="lbl-long">Download only this slide</span>
                  <span className="lbl-short" aria-hidden="true">Download</span>
                </button>
                <Link className="btn btn-sm lb-open-page" to={{ view: 'slide', id: slide.id }} onNavigate={closePreview}>
                  <Icon name="open" />
                  <span>Open slide page</span>
                </Link>
                {deck && (
                  <Link className="btn btn-sm lb-open-deck" to={{ view: 'deck', id: deck.id }} onNavigate={closePreview} aria-label="Open deck" title="Open deck">
                    <Icon name="deck" />
                    <span className="lbl-long">Open deck</span>
                  </Link>
                )}
              </span>
            </div>
          </div>
        </>
      )}
      {zoomed && slide && <SlideViewer src={runtime.assetUrl(slide.previewPath)} title={slide.title} theme={runtime.theme} onClose={() => setZoomed(false)} />}
    </dialog>
  );
}

/**
 * A position like "68" in "68 of 75": a small box you can type in. Enter (or leaving the box) goes to that
 * place, whatever number is typed (kept between 1 and the last); Escape puts the old number back.
 */
export function NumberJump({ value, max, label, onGo, always }: { value: number; max: number; label: string; onGo: (index: number) => void; /** go even when the number is the one already shown (a list you can scroll away from) */ always?: boolean }) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }
  const commit = () => {
    const n = Math.round(Number(text));
    if (!text.trim() || !Number.isFinite(n)) return setText(String(value));
    const to = Math.min(max, Math.max(1, n));
    setText(String(to));
    if (always || to !== value) onGo(to - 1);
  };
  return (
    <input
      className="num-jump"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      maxLength={String(max).length}
      enterKeyHint="go"
      autoComplete="off"
      spellCheck={false}
      style={{ width: `calc(${String(max).length}ch + 10px)` }}
      aria-label={`${label}, a number from 1 to ${max}`}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commit();
          e.currentTarget.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          /* Up and down step the number, like any number box; Enter (or leaving the box) goes there. */
          e.preventDefault();
          e.stopPropagation();
          const now = Math.round(Number(text)) || value;
          setText(String(Math.min(max, Math.max(1, now + (e.key === 'ArrowUp' ? 1 : -1)))));
        } else if (e.key === 'Escape' && text !== String(value)) {
          e.preventDefault();
          e.stopPropagation();
          setText(String(value));
        } else e.stopPropagation(); /* typing digits and arrows here must not move the preview */
      }}
    />
  );
}

/** The source line under the title: one line; on a phone a long name scrolls sideways (with a fade where more is hidden). */
function ScrollLine({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEdgeFade(ref);
  return (
    <p className="meta lb-source" ref={ref}>
      {children}
    </p>
  );
}

type View = { s: number; x: number; y: number };

/**
 * The slide on its own, full screen, to read the small text: pinch with two fingers, drag to move around,
 * double-tap to zoom in or out. The + and - buttons do the same for anyone who can't pinch.
 */
function SlideViewer({ src, title, theme, onClose }: { src: string; title: string; theme: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useDialogOpen(ref, true);
  const [v, setV] = useState<View>({ s: 1, x: 0, y: 0 });
  const [shown, setShown] = useState(false);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);
  const MAX = 5;
  const bound = (n: View): View => {
    const r = stage.current?.getBoundingClientRect();
    const s = Math.min(MAX, Math.max(1, n.s));
    if (s === 1 || !r) return { s: 1, x: 0, y: 0 };
    const mx = ((s - 1) * r.width) / 2;
    const my = ((s - 1) * r.height) / 2;
    return { s, x: Math.min(mx, Math.max(-mx, n.x)), y: Math.min(my, Math.max(-my, n.y)) };
  };
  /* Zoom to `next`, keeping the point (cx, cy), measured from the middle of the screen, where it is. */
  const zoomTo = (next: number, cx = 0, cy = 0) =>
    setV((p) => {
      const s = Math.min(MAX, Math.max(1, next));
      const k = s / p.s;
      return bound({ s, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k });
    });
  const centre = () => {
    const r = stage.current?.getBoundingClientRect();
    return { x: (r?.left ?? 0) + (r?.width ?? 0) / 2, y: (r?.top ?? 0) + (r?.height ?? 0) / 2 };
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const c = centre();
        if (v.s > 1) setV({ s: 1, x: 0, y: 0 });
        else zoomTo(2.5, e.clientX - c.x, e.clientY - c.y);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = pts.current;
    const before = m.get(e.pointerId);
    if (!before) return;
    const after = { x: e.clientX, y: e.clientY };
    if (m.size === 2) {
      const other = [...m.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(before.x - other.x, before.y - other.y) || 1;
      const d1 = Math.hypot(after.x - other.x, after.y - other.y);
      const mid0 = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 };
      const mid1 = { x: (after.x + other.x) / 2, y: (after.y + other.y) / 2 };
      const c = centre();
      setV((p) => {
        const s = Math.min(MAX, Math.max(1, p.s * (d1 / d0)));
        const k = s / p.s;
        const cx = mid1.x - c.x;
        const cy = mid1.y - c.y;
        return bound({ s, x: cx - (cx - p.x) * k + (mid1.x - mid0.x), y: cy - (cy - p.y) * k + (mid1.y - mid0.y) });
      });
    } else if (v.s > 1) {
      setV((p) => bound({ ...p, x: p.x + after.x - before.x, y: p.y + after.y - before.y }));
    }
    m.set(e.pointerId, after);
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId);
  };
  return (
    <dialog ref={ref} className="slidevault sv-zoom" data-theme={theme} aria-label={`${title}, full screen`} onClose={onClose} onKeyDown={(e) => e.stopPropagation()}>
      <div className="sv-zoom-bar">
        <button type="button" className="btn btn-icon" aria-label="Zoom out" disabled={v.s <= 1} onClick={() => zoomTo(v.s / 1.5)}>
          <Icon name="minus" />
        </button>
        <button type="button" className="btn btn-icon" aria-label="Zoom in" disabled={v.s >= MAX} onClick={() => zoomTo(v.s * 1.5)}>
          <Icon name="plus" />
        </button>
        <button type="button" className="btn btn-icon" aria-label="Close full screen view" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div
        ref={stage}
        className="sv-zoom-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => {
          const c = centre();
          zoomTo(v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - c.x, e.clientY - c.y);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0) setShown(true);
          }}
          className={shown ? 'is-loaded' : undefined}
          onLoad={() => setShown(true)}
          onError={() => setShown(true)}
          src={src}
          alt={title}
          draggable={false}
          style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }}
        />
        {!shown && (
          <span className="sv-zoom-wait" aria-hidden="true">
            <span className="sv-ring" />
          </span>
        )}
      </div>
      <p className="sv-zoom-hint">Pinch or double-tap to zoom, drag to move.</p>
    </dialog>
  );
}

type Run = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; fileName: string; note?: string } | { kind: 'error'; message: string };

/** What you are about to download, then the real export. */
export function DownloadDialog() {
  const { runtime, downloadSlides, closeDownload, toast, logActivity, combine, setCombine } = useWorkspace();
  // The result belongs to the slides it was started for, so opening the dialog again starts fresh.
  const [result, setResult] = useState<{
    for: SlideSummary[] | null;
    run: Run;
  }>({ for: null, run: { kind: 'idle' } });
  const run: Run = result.for === downloadSlides ? result.run : { kind: 'idle' };
  const setRun = (r: Run) => setResult({ for: downloadSlides, run: r });
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, !!downloadSlides);

  const slides = downloadSlides ?? [];
  const plan = downloadPlan(slides);
  const canExport = runtime.capabilities.has('export.create');

  async function go() {
    setRun({ kind: 'busy' });
    try {
      const { blob, fileName, note } = await exportPptx(runtime, slides, { combine: plan.zip && combine });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setRun({ kind: 'done', fileName, note });
      toast(note ? `Downloaded ${fileName}. ${note}` : `Downloaded ${fileName}`);
      logActivity('downloaded', fileName);
    } catch (e) {
      const offline = e instanceof TypeError; // fetch rejects with TypeError when the network fails
      setRun({
        kind: 'error',
        message: offline ? 'Could not reach the server. Check your connection and try again.' : (e as Error).message,
      });
    }
  }

  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-dl-title" onClose={closeDownload} onClick={backdropClose(closeDownload)}>
      <div className="dlg-head">
        <div>
          <h2 id="sv-dl-title">Download {plural(slides.length, 'slide')}</h2>
          <p className="meta">
            You get {planSummary(plan, combine)}. Slides stay editable.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={closeDownload}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body">
        <ul className="dl-files">
          {plan.files.map((f) => (
            <li key={f.deckId}>
              <Icon name="file" />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.deckTitle}</span>
              <span className="meta">{plural(f.count, 'slide')}</span>
            </li>
          ))}
        </ul>
        {plan.zip && (
          <label className="fb-check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} disabled={run.kind === 'busy'} />
            <span>Combine into one deck</span>
          </label>
        )}
        <p className="meta" style={{ marginTop: 10 }}>
          {plan.zip && combine ? 'Each slide keeps its own deck’s design, so the file can look a little mixed. ' : ''}
          The file holds only the slides you picked, in this order. Speaker notes and review comments are left out, and source decks are never changed.
        </p>
        {run.kind === 'error' && (
          <div className="notice danger" role="alert">
            <Icon name="alert" />
            <span>{run.message} Your draft deck is unchanged.</span>
          </div>
        )}
        {run.kind === 'done' && (
          <div className="notice info" role="status">
            <Icon name="check" />
            <span>
              Downloaded {run.fileName}.{run.note ? ` ${run.note}` : ''}
            </span>
          </div>
        )}
        {!canExport && (
          <div className="notice info">
            <Icon name="lock" />
            <span>Your access does not include downloads.</span>
          </div>
        )}
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn" onClick={closeDownload}>
          {run.kind === 'done' ? 'Done' : 'Cancel'}
        </button>
        {run.kind !== 'done' && (
          <button type="button" className="btn btn-primary" disabled={!canExport || !slides.length || run.kind === 'busy'} aria-busy={run.kind === 'busy'} onClick={go}>
            <Icon name={run.kind === 'busy' ? 'spinner' : 'download'} className={run.kind === 'busy' ? 'spin' : ''} />
            <span>{run.kind === 'busy' ? 'Building PowerPoint…' : run.kind === 'error' ? 'Try again' : 'Download'}</span>
          </button>
        )}
      </div>
    </dialog>
  );
}

/** Every other deck that holds this slide, or one almost identical to it. Nothing is deleted. */
export function AlsoDialog() {
  const { runtime, library, alsoFor, closeAlso } = useWorkspace();
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, !!alsoFor);
  const group = alsoFor?.alsoIn?.groupId;
  const copies = alsoFor && group && library.status === 'ready' ? [alsoFor, ...library.slides.filter((s) => s.alsoIn?.groupId === group && s.id !== alsoFor.id)] : [];
  const others = Math.max(0, copies.length - 1);

  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-also-title" onClose={closeAlso} onClick={backdropClose(closeAlso)}>
      <div className="dlg-head">
        <div>
          <h2 id="sv-also-title">Also in {plural(others || alsoFor?.alsoIn?.otherDeckCount || 0, 'other deck')}</h2>
          <p className="meta">Also in these decks.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={closeAlso}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body">
        <ul className="also-list">
          {copies.map((c, i) => (
            <li key={c.id}>
              <Link className="t" to={{ view: 'slide', id: c.id }} tabIndex={-1} ariaHidden onNavigate={closeAlso}>
                <Thumb slide={c} />
              </Link>
              <div className="also-txt">
                <Link className="also-name" to={{ view: 'slide', id: c.id }} onNavigate={closeAlso} title={`${c.provenance.sourceTitle}: open this slide to see the full deck name`}>
                  {c.provenance.sourceTitle}
                </Link>
                <div className="meta">
                  {[clientOf(c), yearOf(c), categoryOf(c)].filter((x) => x !== null).join(' · ')} · slide {c.provenance.slideNumber}
                  {i === 0 ? ' (this one)' : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn" onClick={closeAlso}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** The big picture in the preview: tried once more if it fails, then a quiet note instead of a broken-image icon. */
function PreviewPicture({ src, alt }: { src: string; alt: string }) {
  const [tries, setTries] = useState(0);
  if (tries >= 2) {
    return (
      <span className="thumb-missing" role="img" aria-label={`Preview unavailable${alt ? `: ${alt}` : ''}`}>
        <Icon name="alert" />
        <span>Preview unavailable</span>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={tries}
      src={tries === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=1`}
      alt={alt}
      onError={() => {
        if (tries === 0) window.setTimeout(() => setTries(1), 1500);
        else setTries(2);
      }}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
  );
}
