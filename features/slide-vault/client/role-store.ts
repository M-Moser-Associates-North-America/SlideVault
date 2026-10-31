import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { StoryUserRole } from '../contracts/dto';
import type { Transport } from './api';
import { userApi } from './user-api';

/**
 * How this person builds proposals (FD-25), set once in their profile and used to tune the
 * storyboard. The server keeps it (user_settings, FD-71) and wins; this browser holds a copy per
 * signed-in name so the screen and requests can read it at once, and so it still works when the
 * server has no database.
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

/** Put the browser's copy right, and tell every screen reading it. */
function remember(profile: string, next: StoryUserRole | null) {
  try {
    if (next) localStorage.setItem(key(profile), next);
    else localStorage.removeItem(key(profile));
  } catch {
    // Private browsing: the choice lasts until the page is closed.
  }
  listeners.forEach((l) => l());
}

/**
 * The signed-in person's role. Give it the transport once (the workspace does) and it loads the saved
 * role from the server; setRole saves there too and puts the old role back, returning false, if the
 * server says no.
 */
export function useStoryRole(profile: string | null, transport?: Transport) {
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
  useEffect(() => {
    if (!profile || !transport) return;
    let live = true;
    userApi
      .getRole(transport, profile)
      .then((saved) => live && remember(profile, saved))
      .catch(() => {}); // no server or database: keep this browser's copy
    return () => {
      live = false;
    };
  }, [profile, transport]);
  const setRole = useCallback(
    async (next: StoryUserRole | null): Promise<boolean> => {
      if (!profile) return false;
      const before = read(profile);
      remember(profile, next);
      if (!transport) return true;
      try {
        await userApi.setRole(transport, profile, next);
        return true;
      } catch {
        remember(profile, before);
        return false;
      }
    },
    [profile, transport],
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
