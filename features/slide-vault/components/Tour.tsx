'use client';

import { useCallback, useEffect, useState } from 'react';
import { ACTIONS, EVENTS, Joyride, STATUS, type EventData, type Step, type TooltipRenderProps } from 'react-joyride';
import { endTour, startTour, useTourOpen } from '../client/tour-store';
import { useTipSeen } from '../client/tip-store';
import { Icon } from './icons';
import { useRoot } from './root';
import { useWorkspaceCompact, workspaceSizeOf } from './size';
import { useWorkspace } from './state';

/** Wait for the next paint, so a panel opened by a step's `before` has a size to point at. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The tour's card, in the workspace's own styles (Joyride handles placement, spotlight, scrolling and focus). */
function TourCard({ index, size, step, isLastStep, backProps, primaryProps, skipProps, closeProps, tooltipProps }: TooltipRenderProps) {
  return (
    <div className="tour-pop" {...tooltipProps} aria-labelledby="tour-title">
      <button type="button" className="btn btn-ghost btn-icon btn-sm tour-x" {...closeProps} aria-label="Close tour" title="Close tour (Esc)">
        <Icon name="x" />
      </button>
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

/** The order of the steps; the ids let the rules below talk about "the draft deck step" without counting. */
const STEP_IDS = ['welcome', 'search', 'story', 'filters', 'pick', 'deck', 'decks'] as const;
type StepId = (typeof STEP_IDS)[number];

/**
 * A short guided tour built on React Joyride: a dimmed page with a spotlight on one thing at a time
 * and a plain-words note beside it. Shows by itself the first time someone signs in; the header's
 * tour button replays it.
 *
 * How it behaves:
 * - Only "Skip tour", the X and Esc end it. Clicking the dimmed page does nothing, and the spotlighted
 *   thing can be clicked, so people can try what is being pointed at.
 * - Leaving Home pauses it and coming back resumes the same step (opening My decks on the last step,
 *   which is the one pointing at it, finishes the tour). Closing the draft deck on its step pauses it
 *   too, with a Resume button that opens the deck again.
 * - Esc closes the tour first; once it is gone, the next Esc closes the draft deck, one layer at a time.
 */
export function Tour() {
  const open = useTourOpen();
  const { seen, dismiss } = useTipSeen('tour');
  const { profile, runtime, setCartMin, cartMin } = useWorkspace();
  const view = runtime.location.view;
  const onHome = view === 'pages' || view === 'home' || view === 'library';

  const { scroll } = useRoot();
  const toTop = async () => {
    scroll.current?.scrollTo(0, 0);
    await nextFrame();
  };
  const compact = useWorkspaceCompact();
  const bottomTabs = compact;

  const stepFor: Record<StepId, Step> = {
    welcome: {
      target: 'body',
      title: 'Welcome to SlideVault',
      content: 'Find slides from past proposals, then collect the ones you like into a draft deck you can download as an editable PowerPoint.',
      placement: 'center',
      before: toTop,
    },
    search: {
      target: '.home-hero-field',
      title: 'Search in plain words',
      content: 'Type what you are looking for, like “team intro for a law firm pitch”. SlideVault finds matching slides from past proposals.',
      placement: 'bottom',
      before: toTop,
    },
    story: {
      target: '.sb-launch-btn',
      title: 'Build a story with Storyboard',
      content: 'Describe a client’s situation and Storyboard lines up slides from past proposals into a story, part by part, with a note on why each slide fits.',
      placement: compact ? 'bottom' : 'bottom-end',
      before: toTop,
    },
    filters: {
      target: '.fbar-row',
      title: 'Narrow it down',
      content: 'Use Year, Client, Project type and Slide type to cut the list down. The numbers show how many slides match.',
      placement: 'bottom',
      before: toTop,
    },
    pick: {
      target: '.sv-main .vcard',
      title: 'Pick the slides you want',
      content: 'Tick the corner box on a slide to add it to your draft deck. Click the slide to preview it, and use the heart to save it for later. (Slides marked “Pack” belong together, so you can add the whole pack.)',
      placement: 'auto',
    },
    deck: {
      // On a phone the panel fills the right side, so the note goes under its header instead of beside it.
      target: compact ? '.cart-col .cart-head' : '.cart-col',
      title: 'Your draft deck',
      content: 'Ticked slides collect here. Name your deck, drag slides into order, then download them together or save the set as a draft. Picked slides from different decks? Tick “Combine into one deck” to download them as a single PowerPoint.',
      placement: compact ? 'bottom' : 'left',
      before: async () => {
        setCartMin(false);
        await nextFrame();
        // On phones the panel slides in; wait until it has arrived so the tour can find it.
        await new Promise((resolve) => setTimeout(resolve, 320));
      },
    },
    decks: {
      // Only the My decks tab is lit, not the whole row of tabs.
      target: bottomTabs ? '.sv-bottombar a[href$="/profile"]' : '.sv-nav a[href$="/profile"]',
      title: 'Find your saved work',
      content: 'My decks keeps your saved slides and drafts. You can replay this tour any time with the ? button at the top of the page.',
      placement: bottomTabs ? 'top' : 'bottom',
      before: async () => {
        // Where the draft deck covers the page (phone, upright tablet), put it away so the tabs show.
        if (workspaceSizeOf(document.querySelector('.slidevault .cart-col')) !== 'wide') {
          setCartMin(true);
          await new Promise((resolve) => setTimeout(resolve, 320));
        }
        await toTop();
      },
    },
  };
  const steps = STEP_IDS.map((id) => stepFor[id]);

  /* Where the tour is, kept here so leaving Home and coming back resumes the same step. */
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState<number | null>(null); // the step whose note is on screen right now
  const idOf = (i: number): StepId | undefined => STEP_IDS[i];
  /* Paused because the person left Home, or closed the draft deck while it is the thing being pointed at. */
  const away = open && !onHome;
  const deckClosed = open && idOf(shown ?? -1) === 'deck' && cartMin;
  const paused = away || deckClosed;

  /* First sign-in: start by itself, once, when Home is showing. */
  useEffect(() => {
    if (profile && !seen && onHome && !open) {
      const t = setTimeout(startTour, 900);
      return () => clearTimeout(t);
    }
  }, [profile, seen, onHome, open]);

  /* Replaying from somewhere else brings the person back to Home; the tour always starts at the first step. */
  useEffect(() => {
    if (open && !onHome) runtime.navigate({ view: 'pages' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = useCallback(() => {
    dismiss();
    endTour();
    setIndex(0);
    setShown(null);
  }, [dismiss]);

  /* Opening My decks while its own step is showing finishes the tour; leaving Home any other way just pauses it. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to navigation, which happens outside React state
    if (open && view === 'profile' && idOf(index) === 'decks') close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view]);

  /* Esc closes the tour first. Catching it before anything else sees it means the draft deck stays open
     for this press, and the next Esc (the tour is gone) closes the deck. */
  useEffect(() => {
    if (!open || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, paused, close]);

  const onEvent = useCallback(
    (data: EventData) => {
      if (data.type === EVENTS.TOOLTIP) setShown(data.index);
      if (data.action === ACTIONS.CLOSE || data.action === ACTIONS.SKIP) {
        close();
        return;
      }
      /* Pausing also reports the step as finished (status "paused"); only a real Next or Back moves on. */
      if (data.type === EVENTS.STEP_AFTER && data.status === STATUS.RUNNING) {
        if (data.action === ACTIONS.NEXT) {
          if (data.index + 1 >= STEP_IDS.length) close();
          else setIndex(data.index + 1);
        } else if (data.action === ACTIONS.PREV) setIndex(Math.max(0, data.index - 1));
      }
      if (data.type === EVENTS.TOUR_END) close();
    },
    [close],
  );

  const resume = () => {
    if (away) runtime.navigate({ view: 'pages' });
    if (deckClosed) setCartMin(false);
  };

  if (!profile) return null;
  return (
    <>
      <Joyride
        run={open && !paused}
        stepIndex={index}
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
          dismissKeyAction: false, // Esc is handled above, so it never also closes the draft deck
          overlayClickAction: false, // a stray click on the dimmed page must not end the tour
          overlayColor: 'rgba(15, 15, 18, 0.55)',
          spotlightPadding: 8,
          spotlightRadius: 14,
          // Room for the sticky tabs row, so a target never hides under it
          scrollOffset: 160,
          zIndex: 90,
        }}
      />
      {open && paused && (
        <div className="tour-paused" role="status">
          <span className="tour-paused-t">{away ? 'Tour paused. Go back to Home to continue.' : 'Tour paused. The draft deck was closed.'}</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={resume}>
            {away ? 'Back to Home' : 'Resume'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
            End tour
          </button>
        </div>
      )}
    </>
  );
}
