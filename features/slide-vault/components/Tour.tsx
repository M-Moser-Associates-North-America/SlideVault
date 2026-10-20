'use client';

import { useCallback, useEffect } from 'react';
import { ACTIONS, EVENTS, Joyride, type EventData, type Step, type TooltipRenderProps } from 'react-joyride';
import { endTour, startTour, useTourOpen } from '../client/tour-store';
import { useTipSeen } from '../client/tip-store';
import { useWorkspace } from './state';

/** Wait for the next paint, so a panel opened by a step's `before` has a size to point at. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const toTop = async () => {
  window.scrollTo(0, 0);
  await nextFrame();
};

/** The tour's card, in the workspace's own styles (Joyride handles placement, spotlight, scrolling and focus). */
function TourCard({ index, size, step, isLastStep, backProps, primaryProps, skipProps, tooltipProps }: TooltipRenderProps) {
  return (
    <div className="tour-pop" {...tooltipProps} aria-labelledby="tour-title">
      <p className="tour-n">
        Step {index + 1} of {size}
      </p>
      <h2 id="tour-title">{step.title}</h2>
      <p className="tour-t">{step.content}</p>
      <div className="tour-acts">
        <button type="button" className="btn btn-ghost btn-sm" {...skipProps}>
          Skip tour
        </button>
        <span className="tour-nav">
          {index > 0 && (
            <button type="button" className="btn btn-sm" {...backProps}>
              Back
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" {...primaryProps}>
            {isLastStep ? 'Done' : 'Next'}
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * A short guided tour built on React Joyride: a dimmed page with a spotlight on one thing at a time
 * and a plain-words note beside it. Shows by itself the first time someone signs in; the header's
 * tour button replays it.
 */
export function Tour() {
  const open = useTourOpen();
  const { seen, dismiss } = useTipSeen('tour');
  const { profile, runtime, setCartMin } = useWorkspace();
  const onHome = runtime.location.view === 'pages' || runtime.location.view === 'home' || runtime.location.view === 'library';

  const steps: Step[] = [
    {
      target: '.home-hero-field',
      title: 'Search in plain words',
      content: 'Type what you are looking for, like “team intro for a law firm pitch”. SlideVault finds matching slides from past proposals.',
      placement: 'bottom',
      before: toTop,
    },
    {
      target: '.fbar-row',
      title: 'Narrow it down',
      content: 'Use Year, Client, Project type and Slide type to cut the list down. The numbers show how many slides match.',
      placement: 'bottom',
      before: toTop,
    },
    {
      target: '.sv-main .vcard',
      title: 'Pick the slides you want',
      content: 'Tick the corner box on a slide to add it to your draft deck. Click the slide to preview it, and use the heart to save it for later.',
      placement: 'auto',
    },
    {
      target: '.cart-col',
      title: 'Your draft deck',
      content: 'Ticked slides collect here. Name your deck, drag slides into order, then download them together or save the set as a draft.',
      placement: 'left',
      before: async () => {
        setCartMin(false);
        await nextFrame();
      },
    },
    {
      target: '.sv-nav',
      title: 'Find your saved work',
      content: 'My decks keeps your saved slides and drafts. You can replay this tour any time with the ? button at the top of the page.',
      placement: 'bottom',
      before: toTop,
    },
  ];

  /* First sign-in: start by itself, once, when Home is showing. */
  useEffect(() => {
    if (profile && !seen && onHome && !open) {
      const t = setTimeout(startTour, 900);
      return () => clearTimeout(t);
    }
  }, [profile, seen, onHome, open]);

  /* Always tour from the first step, on Home. */
  useEffect(() => {
    if (open && !onHome) runtime.navigate({ view: 'pages' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = useCallback(() => {
    dismiss();
    endTour();
  }, [dismiss]);

  const onEvent = useCallback(
    (data: EventData) => {
      if (data.type === EVENTS.TOUR_END || data.action === ACTIONS.CLOSE || data.action === ACTIONS.SKIP) close();
    },
    [close],
  );

  if (!profile) return null;
  return (
    <Joyride
      run={open}
      steps={steps}
      continuous
      scrollToFirstStep
      onEvent={onEvent}
      tooltipComponent={TourCard}
      portalElement=".slidevault"
      locale={{ back: 'Back', close: 'Close', last: 'Done', next: 'Next', skip: 'Skip tour' }}
      options={{
        skipBeacon: true,
        buttons: ['back', 'primary', 'skip'],
        dismissKeyAction: 'close',
        overlayClickAction: 'close',
        overlayColor: 'rgba(15, 15, 18, 0.55)',
        spotlightPadding: 8,
        spotlightRadius: 14,
        // Room for the sticky tabs row, so a target never hides under it
        scrollOffset: 160,
        zIndex: 90,
      }}
    />
  );
}
