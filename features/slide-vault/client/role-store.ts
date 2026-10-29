import { useCallback, useSyncExternalStore } from 'react';
import type { StoryUserRole } from '../contracts/dto';

/**
 * How this person builds proposals (FD-25), set once in their profile and used to tune the
 * storyboard. Kept in this browser per signed-in name for now; it moves to user_settings on the
 * server with the rest of the profile once M Moser's login plugs in.
 */
const key = (profile: string) => `slidevault:${profile}:role`;
const listeners = new Set<() => void>();
const ROLES: readonly StoryUserRole[] = ['business-developer', 'director', 'bd-support'];

function read(profile: string | null): StoryUserRole | null {
  if (!profile) return null;
  try {
    const v = localStorage.getItem(key(profile));
    return ROLES.includes(v as StoryUserRole) ? (v as StoryUserRole) : null;
  } catch {
    return null;
  }
}

/** The signed-in person's role right now, for a request (search sends it, FD-59); null when not set. */
export function currentStoryRole(): StoryUserRole | null {
  try {
    return read(localStorage.getItem('slidevault:profile'));
  } catch {
    return null;
  }
}

export function useStoryRole(profile: string | null) {
  const role = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => read(profile),
    () => null,
  );
  const setRole = useCallback(
    (next: StoryUserRole | null) => {
      if (!profile) return;
      try {
        if (next) localStorage.setItem(key(profile), next);
        else localStorage.removeItem(key(profile));
      } catch {
        // Private browsing: the choice lasts until the page is closed.
      }
      listeners.forEach((l) => l());
    },
    [profile],
  );
  return { role, setRole };
}

/** What each role is, in Grant's words from the 21 Oct meeting. */
export const ROLE_CHOICES: { role: StoryUserRole; label: string; day: string; tuned: string }[] = [
  { role: 'business-developer', label: 'Business developer', day: 'You meet clients, research them and pursue the work.', tuned: "Stories lead with the client's challenge and what we've learned about them." },
  { role: 'director', label: 'Director', day: 'You lead the proposal: the story, our capabilities and the pricing.', tuned: 'Stories lean on why M Moser, value and cost, and ask about budget and sign-off.' },
  { role: 'bd-support', label: 'BD support / marketing', day: 'You pull the slides, put them in order and make them look right, often on a deadline.', tuned: 'More options in every part and fewer questions, so you can build fast.' },
];
