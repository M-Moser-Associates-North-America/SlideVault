/**
 * The first name to greet someone with, from how they are signed in: "Person A" gives "Person", and an address like
 * "khushali.haji@example.com" gives "Khushali". A placeholder until the real login gives a proper first name.
 */
export function firstNameOf(profile: string | null | undefined): string {
  const raw = (profile ?? '').trim();
  if (!raw) return '';
  const word = raw.includes('@') ? raw.split('@')[0].split(/[._\-+\s]+/)[0] : raw.split(/\s+/)[0];
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}
