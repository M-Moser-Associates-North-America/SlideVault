# Accessibility record

Target: **WCAG 2.2 AA** (`docs/DESIGN_SYSTEM.md`, "Accessibility acceptance"). This page records how each requirement is verified and the latest results.

## Automated: every change, in CI

`npm run test:a11y` (Playwright + axe-core, `tests/e2e/accessibility.spec.ts`) runs against a production build of the synthetic library:

| Requirement | How it's checked |
| --- | --- |
| Text and placeholder contrast; non-text contrast | axe-core WCAG 2.2 AA rules, **light and dark** themes, with selected states, the preview dialog, empty results and an export error |
| Visible focus | Tab through every control; each shows a 2px solid outline |
| Target size | Every button and input ≥ 24 × 24 CSS px |
| Keyboard-only workflow | Search, select, reorder and export with the keyboard alone |
| Predictable focus | Preview: focus moves into the dialog, returns to the opener on Escape |
| Semantics | One header / main / labelled aside, one h1, no skipped heading levels, named controls |
| Reflow and motion | No sideways scroll at 320 px (400% zoom); transitions off with reduced motion |

Latest local result (7 October 2026): **10/10 tests pass**, stable over three consecutive runs.

## Manual: screen reader (VoiceOver on macOS)

Automated tools can't judge whether the app *makes sense* when heard. The design doc asks for a person to test the primary workflow with a screen reader. Run this on each milestone.

**Setup:** start the app (`npm run dev`), open http://localhost:3000/slide-vault/pages in **Safari**, then press **Cmd + F5** to turn VoiceOver on (Cmd + F5 again turns it off).

**Keys:** **Tab** / **Shift + Tab** move between controls · **Enter** activates · **Control + Option + →** reads the next item · **Control + Option + U** opens the rotor (lists headings, landmarks, links) · **Control** stops speech.

| # | Do this | You should hear | Result | Notes |
| --- | --- | --- | --- | --- |
| 1 | Load the page, open the rotor (Ctrl + Opt + U), arrow to **Landmarks** | banner, main, "Selection" complementary | | |
| 2 | In the rotor, arrow to **Headings** | "Slides" (level 1), slide titles, "Selection" | | |
| 3 | Tab to the search box | "Search slides, search text field" | | |
| 4 | Type `leadership` and wait | "1 result for leadership" announced without moving focus | | |
| 5 | Clear the search, Tab to a **Select** button, press Enter | "Select, toggle button, not pressed" → after Enter: "pressed"; the Selection count updates | | |
| 6 | Select two more slides, then Tab to the selection list | "Move [title] up / down", "Remove [title] from selection" | | |
| 7 | Press Enter on a **Move … up** button | Order changes; focus stays on the button | | |
| 8 | Tab to **Export editable PowerPoint**, press Enter | "Building PowerPoint", then "Downloaded SlideVault-export.pptx with 3 slides" | | |
| 9 | Tab to a **Preview** button, press Enter | Dialog announced with the slide title; focus inside | | |
| 10 | Tab through the dialog to "Slide text" | "Slide text, region"; arrow keys scroll it | | |
| 11 | Press Escape | Dialog closes; focus back on the Preview button you used | | |
| 12 | Search for `zzqq` | "0 results"; "No slides match" message reachable | | |

Record the date, tester, browser and macOS version with the results. Anything confusing, silent or out of order is a finding even if the checks above pass.
