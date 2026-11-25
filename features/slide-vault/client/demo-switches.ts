/**
 * The pretend-data switches in the address (?demotags=1, ?demopacks=1, ?demodetails=1) work only where this setting is on:
 * NEXT_PUBLIC_SLIDEVAULT_DEMO_SWITCHES=1, for a computer or a test run on the synthetic sample decks (tests/fixtures).
 * Off by default, so the app connected to the real library never shows made-up authors, tags, votes, comments or packs,
 * and no pretend edit can look saved there.
 */
export const demoSwitchesAllowed = process.env.NEXT_PUBLIC_SLIDEVAULT_DEMO_SWITCHES === '1';
