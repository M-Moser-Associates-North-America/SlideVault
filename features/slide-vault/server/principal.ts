import 'server-only';

/**
 * Who is asking, for per-person data (saved slides, My decks, activity). docs/DECISIONS.md FD-18.
 *
 * PROTOTYPE STAND-IN. Until M Moser's sign-in is plugged in (FD-01), the app sends the signed-in
 * profile name in the X-SlideVault-User header. Anyone can send any name, so this keeps people's
 * data apart in a demo but is not security. At integration, replace the body of userOf() with the
 * user M Moser's platform has verified (for example from its session or a signed token). Nothing
 * else changes: every per-person query already goes through this one function.
 */
export const USER_HEADER = 'x-slidevault-user';

export function userOf(request: Request): string | null {
  const raw = request.headers.get(USER_HEADER);
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Control characters anywhere (even ones trim() would hide) mean a malformed name.
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  const name = decoded.trim();
  return name && name.length <= 80 ? name : null;
}
