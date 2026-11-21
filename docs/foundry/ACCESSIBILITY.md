# Accessibility record

Target: **WCAG 2.2 AA** (`docs/DESIGN_SYSTEM.md`, "Accessibility acceptance"). This page records how each requirement is verified, the latest results, and what is still open.

## Automated: every change, in CI

`npm run test:a11y` (Playwright + axe-core) runs against a production build of the synthetic library, in three files:

| File | What it covers |
| --- | --- |
| `tests/e2e/accessibility.spec.ts` (24 tests) | Home, results, deck page, slide page, Create, Upload, sign-in, preview and download dialogs, empty results, the download error: axe WCAG 2.2 AA in **light and dark**; a 2px focus outline on every control; targets ≥ 24 × 24; search, select, reorder and download by keyboard alone; focus into and out of the preview; landmarks and headings; no sideways scroll at 320 px; reduced motion; phones at 390 px |
| `tests/e2e/storyboard.spec.ts` (40 tests) | **Every Storyboard screen**: the brief and "too short", Composing and Stop (Escape too), the error, the finished story (beats, "+N", Useful / Not useful, preview, Add the story to the draft deck, Talk to your story, Start over) and both "From your library" answers. axe in light and dark on each; the whole flow by keyboard alone; focus outlines; targets ≥ 24 × 24 or spaced as WCAG 2.5.8 allows; **phone 390 px, tablet 768 px upright and 1024 px sideways, and 320 px**; reduced motion. The story is the real one (rules, synthetic library); only a slow answer, a failed one, the "From your library" answers and the Talk reply are stood in, each marked in the file |
| `tests/e2e/screen-reader.spec.ts` (7 tests) | The 12-step walk-through below, checked against the accessibility tree |

An open issue has a test marked `test.fail`: it fails today, and the day it is fixed Playwright reports "expected to fail, but passed", so the fix can't go unnoticed. Fixed issues keep their tests as ordinary ones, so they stay fixed.

Latest local result (11 November 2026, branch from `foundry-release` at `958b0df`): **70 passed, 1 skipped** (71 tests; the skipped one is the on-demand race check, A10) in 43 s. The Storyboard and screen-reader files also passed **3 runs in a row** (114 and 21 test runs). On a machine already running a local AI model, a full run took 20 minutes and some tests, old and new, ran out of time: that is the machine, not the app, but expect it if you run the suite beside a model.

## Screen-reader walk-through (the 12 steps)

**How it was checked (11 Nov):** each step against the browser's accessibility tree, which is what VoiceOver reads: roles, names, states, focus and live announcements (`tests/e2e/screen-reader.spec.ts`). That shows the app gives a screen reader the right things to say. It is **not** a person listening: whether VoiceOver actually speaks each announcement, and how it sounds, still needs a person (Safari + VoiceOver, below). The steps are updated to today's screens; the old ones named "Selection" and "Export editable PowerPoint", which no longer exist.

| # | Do this | A screen reader should get | Automated (11 Nov) | Person with VoiceOver |
| --- | --- | --- | --- | --- |
| 1 | Open Home, rotor → Landmarks | banner, Main navigation, main, search, "Draft deck" complementary | Pass | To do |
| 2 | Rotor → Headings | one level-1 "Home"; no skipped levels | Pass | To do |
| 3 | Tab to the search box | "I'm looking for (search slides)", search field, inside a search landmark | Pass | To do |
| 4 | Type `leadership`, Enter | "N slides from N decks" from a polite live region; focus stays in the box | Pass (live region present; focus stays) | **Listen**: the count's live region appears with its text, which some screen readers don't announce the first time; check it is spoken after the first search |
| 5 | Tab to a slide's **Add to draft deck** checkbox, Space | "Add to draft deck: [title], checkbox"; checked; an announcement | Pass, with a note: the app announces "Added to draft deck: [title]" and the general message then replaces it, so what is heard is "Added. 1 slide ready" | **Listen**: which one is spoken |
| 6 | Add a second slide; Tab into the draft deck | "Reorder: [title]" and "Remove … [title]" buttons | Pass | To do |
| 7 | On a Reorder button, Arrow Up | "[title] moved to position 1 of 2"; focus stays on it | Pass | To do |
| 8 | **Download as pptx**, Enter; **Download**, Enter | a named dialog, focus inside; the file downloads | Pass | To do |
| 9 | A **Preview** button, Enter | a dialog named with the slide title; focus inside | Pass | To do |
| 10 | In the preview | its place in the results ("N of N") in a polite live region | Pass | To do |
| 11 | Escape | the dialog closes; focus back on the Preview button | Pass | To do |
| 12 | Search `zzqq` | "No slides found" announced; the message and Clear search reachable | Pass (A1 fixed 17 Nov): reachable, and announced in the polite live region | To do |

**For the person:** start the app (`npm run dev`), open http://localhost:3000/slide-vault/pages in **Safari**, press **Cmd + F5** for VoiceOver. **Tab** / **Shift + Tab** move, **Enter** activates, **Control + Option + →** reads on, **Control + Option + U** opens the rotor, **Control** stops speech. Record the date, tester, browser and macOS version. Anything confusing, silent or out of order is a finding even if the automated column passes.

## Findings (found 11 November 2026)

Each was measured, not judged by eye, and each has a test. **A2 to A10 are on the Storyboard and were fixed the same day** (Schiffon's screens: `StoryboardView.tsx`, `storyboard.css`); their tests now pass and keep them fixed. A1 and A11 are on Home and search (Khushali's screens); both were fixed on 17 Nov.

| # | WCAG | Where | Before (measured) | Now | Test |
| --- | --- | --- | --- | --- | --- |
| A1 | 4.1.3 Status Messages (AA) | Search, no results | "No slides found" not announced: `StateBlock` (`parts.tsx`) has a role only for errors, and nothing calls `announce()` | **Fixed 17 Nov**: `ResultsView` calls `announce()` when a search or list comes back empty | `screen-reader.spec.ts`, step 12 (now an ordinary test, passes) |
| A2 | 2.5.3 Label in Name (A) | Storyboard, Pull the story | Shows "Start planning story" on hover and focus, named "Pull the story": voice control can't find it by what it shows | Fixed: named "Pull the story: start planning story", so either phrase works | `storyboard.spec.ts`, brief |
| A3 | 1.4.3 Contrast (AA) | "Storyboard" / "Composing" / "From your library" label, light | 4.09:1 | 5.20:1 | contrast of the Storyboard orange |
| A4 | 1.4.3 | Pull the story on hover / focus | 3.52:1 light, 3.11:1 dark | 5.72:1 both | same |
| A5 | 1.4.3 | Composing: current step; steps to come (were at 55% opacity) | 4.09:1 light; 2.15:1 light, 3.23:1 dark | 5.20:1; 4.84:1 light, 8.34:1 dark (secondary text colour, no fading) | same |
| A6 | 1.4.3 | Beat numbers "01", "02"…, light | 3.20:1 | 5.20:1 | same |
| A7 | 1.4.3 | "Matches …" under each slide, light | 4.09:1 | 5.20:1 | same |
| A8 | 1.4.3 | "Talk to your story" heading, light | 4.09:1 | 5.20:1 | same |
| A9 | 1.4.3 | "Hide the other slides" once a beat is open | 2.74:1 dark | 5.72:1 both | same |
| A10 | 2.4.3 Focus Order (A) | Storyboard, "From your library" answers | Focus reached the new title 1 of 5 times with the CPU slowed 6× (a story: 5 of 5); otherwise it fell to the page. The title was focused in `requestAnimationFrame`, which could run before the new screen was drawn | Fixed: focused after the screen renders | `storyboard.spec.ts`, "even on a slow machine" (in CI) |
| A11 | 1.4.3 | Home: the Storyboard launch button while it glows (`.sb-launch-btn.is-glow`) | From the CSS values, not yet on screen in a test: #e03408 on the tint #ffe6dc is 3.77:1 (light) | **Fixed 17 Nov**: the glowing button's text uses `--sb-orange-text` (#c22d07), 4.79:1 on the tint; dark mode unchanged | none yet (value worked out from the CSS, not measured on screen) |

**How the Storyboard colours were fixed, uniformly:** one orange, `--sb-orange-text` / `--sb-orange-fill` in `storyboard.css`, wherever the Storyboard uses orange as text or behind white text: #c22d07, the brand orange darker, which passes on every background it sits on (5.20:1 on the page, 5.72:1 on white, 4.79:1 on the orange tint, white on it 5.72:1). In dark mode orange text keeps #ff7048 (7.14:1 on the page, 5.37:1 on the tint); white-on-orange uses #c22d07 in both themes. Lines, outlines, the progress bar and icons keep the brand orange: they need 3:1, which it meets. A1 and A11 could use the same token if it moves into `docs/design-tokens.css`.
