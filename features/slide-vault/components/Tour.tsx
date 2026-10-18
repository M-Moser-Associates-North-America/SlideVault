'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { endTour, startTour, useTourOpen } from '../client/tour-store';
import { useTipSeen } from '../client/tip-store';
import { useWorkspace } from './state';

type Place = 'auto' | 'left';
type Step = { title: string; text: string; target: () => HTMLElement | null; place?: Place; before?: () => void };

const PAD = 8;
const GAP = 16;
const WIDTH = 340;

/**
 * A short guided tour: a dimmed page with a spotlight on one thing at a time and a plain-words note
 * beside it. Shows by itself the first time someone signs in; the header's tour button replays it.
 */
export function Tour() {
  const open = useTourOpen();
  const { seen, dismiss } = useTipSeen('tour');
  const { profile, runtime, setCartMin } = useWorkspace();
  const onHome = runtime.location.view === 'pages' || runtime.location.view === 'home' || runtime.location.view === 'library';
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [popH, setPopH] = useState(220);
  const pop = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  const top = () => window.scrollTo(0, 0);
  const steps: Step[] = [
    {
      title: 'Search in plain words',
      text: 'Type what you are looking for, like “team intro for a law firm pitch”. SlideVault finds matching slides from past proposals.',
      target: () => document.querySelector<HTMLElement>('.home-hero-field'),
      before: top,
    },
    {
      title: 'Narrow it down',
      text: 'Use Year, Client, Project type and Slide type to cut the list down. The numbers show how many slides match.',
      target: () => document.querySelector<HTMLElement>('.fbar-row'),
      before: top,
    },
    {
      title: 'Pick the slides you want',
      text: 'Tick the corner box on a slide to add it to your draft deck. Click the slide to preview it, and use the heart to save it for later.',
      target: () => document.querySelector<HTMLElement>('.sv-main .vcard'),
      before: () => document.querySelector<HTMLElement>('.sv-main .vcard')?.scrollIntoView({ block: 'center' }),
    },
    {
      title: 'Your draft deck',
      text: 'Ticked slides collect here. Name your deck, drag slides into order, then download them together or save the set as a draft.',
      target: () => document.querySelector<HTMLElement>('.cart-col'),
      place: 'left',
      before: () => setCartMin(false),
    },
    {
      title: 'Find your saved work',
      text: 'My decks keeps your saved slides and drafts. You can replay this tour any time with the ? button at the top of the page.',
      target: () => document.querySelector<HTMLElement>('.sv-nav'),
      before: top,
    },
  ];
  const step = steps[Math.min(i, steps.length - 1)];

  /* First sign-in: start by itself, once, when Home is showing. */
  useEffect(() => {
    if (profile && !seen && onHome && !open) {
      const t = setTimeout(startTour, 900);
      return () => clearTimeout(t);
    }
  }, [profile, seen, onHome, open]);

  /* Always tour from the first step, on Home. */
  useEffect(() => {
    if (!open) return;
    if (!onHome) runtime.navigate({ view: 'pages' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = useCallback(() => {
    dismiss();
    endTour();
    setI(0);
  }, [dismiss]);

  /* Step change: get the target ready, then keep measuring it (the page may still be loading). */
  const stepKey = open ? i : -1;
  useEffect(() => {
    if (stepKey < 0) return;
    steps[stepKey]?.before?.();
    const measure = () => {
      const el = steps[stepKey]?.target();
      const r = el?.getBoundingClientRect();
      setBox(r && r.width > 0 && r.height > 0 ? r : null);
      if (pop.current) setPopH(pop.current.offsetHeight);
    };
    const t = setTimeout(measure, 60);
    const iv = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      clearTimeout(t);
      clearInterval(iv);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  useEffect(() => {
    if (open) title.current?.focus();
  }, [open, i]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);

  if (!open || !profile) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(WIDTH, vw - 24);
  let left = (vw - w) / 2;
  let topPx = (vh - popH) / 2;
  if (box) {
    const clampX = (x: number) => Math.max(12, Math.min(vw - w - 12, x));
    const clampY = (y: number) => Math.max(12, Math.min(vh - popH - 12, y));
    const below = box.bottom + PAD + GAP;
    const above = box.top - PAD - GAP - popH;
    if (step.place !== 'left' && below + popH <= vh - 12) {
      left = clampX(box.left);
      topPx = below;
    } else if (step.place !== 'left' && above >= 12) {
      left = clampX(box.left);
      topPx = above;
    } else if (box.left - PAD - GAP - w >= 12) {
      left = box.left - PAD - GAP - w;
      topPx = clampY(box.top);
    } else {
      left = clampX(box.right + PAD + GAP);
      topPx = clampY(box.top);
    }
  }
  const last = i >= steps.length - 1;

  return (
    <div className="tour" role="presentation">
      <div className="tour-block" onClick={close} />
      {box && <div className="tour-spot" style={{ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }} aria-hidden="true" />}
      <div ref={pop} className="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={{ left, top: topPx, width: w }}>
        <p className="tour-n">
          Step {i + 1} of {steps.length}
        </p>
        <h2 id="tour-title" ref={title} tabIndex={-1}>
          {step.title}
        </h2>
        <p className="tour-t">{step.text}</p>
        <div className="tour-acts">
          <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
            Skip tour
          </button>
          <span className="tour-nav">
            {i > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => setI(i - 1)}>
                Back
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => (last ? close() : setI(i + 1))}>
              {last ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
