import { useCallback, useSyncExternalStore } from 'react';
import type { StoryUserRole } from '../contracts/dto';

/**
 * How this person builds proposals (FD-25), set once in their profile and used to tune the
 * storyboard. Kept in this browser per signed-in name so the screen and requests can read it at
 * once; the workspace also saves it on the server (user_settings, FD-71) through onRoleChange.
 */
const key = (profile: string) => `slidevault:${profile}:role`;
const listeners = new Set<() => void>();
/** Where a change of role is also saved (the server's user_settings, FD-71); set by the workspace. */
let saveRole: ((role: StoryUserRole | null) => void) | null = null;
export function onRoleChange(save: ((role: StoryUserRole | null) => void) | null) {
  saveRole = save;
}
/** The role the server has for this person, when this browser has none yet (a new browser, a cleared one). */
export function adoptServerRole(profile: string, role: StoryUserRole | null) {
  if (!role || !ROLES.includes(role) || read(profile)) return;
  try {
    localStorage.setItem(key(profile), role);
  } catch {
    return;
  }
  listeners.forEach((l) => l());
}
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
      saveRole?.(next);
    },
    [profile],
  );
  return { role, setRole };
}

/** The role as the account menu shows it. */
export function useRoleLabel(profile: string | null): string {
  const { role } = useStoryRole(profile);
  return ROLE_CHOICES.find((c) => c.role === role)?.label ?? 'No role set';
}

/** What each role is, in Grant's words from the 21 Oct meeting. */
export const ROLE_CHOICES: { role: StoryUserRole; label: string; day: string; tuned: string }[] = [
  { role: 'business-developer', label: 'Business developer', day: 'You meet clients, research them and pursue the work.', tuned: "Stories lead with the client's challenge and what we've learned about them." },
  { role: 'director', label: 'Director', day: 'You lead the proposal: the story, our capabilities and the pricing.', tuned: 'Stories lean on why M Moser, value and cost, and ask about budget and sign-off.' },
  { role: 'bd-support', label: 'BD support / marketing', day: 'You pull the slides, put them in order and make them look right, often on a deadline.', tuned: 'More options in every part and fewer questions, so you can build fast.' },
];
