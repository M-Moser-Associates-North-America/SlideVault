# SlideVault design contract

**Curated external-team handoff · 2026-09-29**

SlideVault is a workspace for finding, reviewing and assembling presentation content. Its visual identity uses calm neutral surfaces, precise typography and restrained orange accents. This document defines the recommended design baseline for the standalone product.

Use [design-tokens.css](design-tokens.css) for the recommended visual baseline. The supplied [HTML mockup](../reference/SlideVault.html) illustrates workflows and screen composition; its bundled framework, sample data, simulated interactions and hard-coded layouts are not production requirements. This contract takes precedence where visual details differ. The product specification and delivery plan determine functional scope.

## Visual direction

- Use cool neutral backgrounds, white or near-black panels, readable text and restrained orange accents.
- Keep primary actions neutral: near-black with white text in light mode; near-white with dark text in dark mode. Orange identifies selection, focus and small brand accents.
- Create hierarchy with size, weight, spacing and subtle borders. Keep shadows soft. Reserve extra color for slide content and status indicators.
- Show real slide previews with their original colors and proportions. The surrounding application chrome stays quiet.
- Use sentence case and short, concrete action labels: “Upload deck”, “Add slides”, “Export deck”. Do not use emoji, promotional claims or success messages before work has succeeded.

## Containment and theme

Build workspace content inside a `.slidevault` root and keep it separate from the standalone application's navigation and account pages. SlideVault may later integrate into an unspecified internal system. This separation should allow a future adapter to place the workspace in a parent container and supply theme or navigation context. Workspace headings, tabs, breadcrumbs, filters and actions belong to the workspace; application-wide navigation and sign-in belong to the standalone shell.

The token stylesheet defines namespaced variables without resetting `html`, `body` or native controls. Keep feature styles scoped through CSS modules or the feature root. Application-level code should own document classes, theme persistence and global scrolling; feature components should work within their assigned container.

The stylesheet supports these theme inputs:

| Context | Usage |
| --- | --- |
| Standalone light preview | `<div class="slidevault" data-theme="light">` |
| Standalone dark preview | `<div class="slidevault" data-theme="dark">` |
| Ancestor-class preview | `<div class="slidevault">` beneath a `.dark` ancestor |

The `.dark` ancestor is a SlideVault styling and test convention. An explicit `data-theme` overrides it. Feature code should consume the semantic tokens so a future adapter can supply different values without changing each component. Portals for menus, drawers and dialogs must receive the same feature root class and theme context, or mount within a correctly themed portal container.

## Foundation tokens

### Color

These colors define SlideVault's interface palette. The stylesheet contains the complete minimal subset used by this handoff.

| Role | Light | Dark |
| --- | --- | --- |
| Brand accent | `#FF3F0A` | `#FF5A2C` |
| Strong brand accent | `#D93407` | `#FF7048` |
| Application background | `#F3F4F6` | `#0B0C0F` |
| Panel surface | `#FFFFFF` | `#191A1E` |
| Sunken surface | `#ECEEF1` | white at 8% |
| Hover/muted surface | `#E4E7EB` | white at 12% |
| Primary text | `#1A1A1A` | `#F4F4F4` |
| Secondary text | `#6B6B6B` | `#A9A9AC` |
| Primary action background | `#1A1A1A` | `#FAFAFA` |
| Primary action foreground | `#FFFFFF` | `#0B0B0D` |
| Decorative border | `rgba(20,20,20,.12)` | `rgba(255,255,255,.14)` |
| Strong decorative border | `rgba(20,20,20,.20)` | `rgba(255,255,255,.23)` |
| Success accent | `#1F9D63` | `#34C77D` |
| Warning accent | `#C9930C` | `#E0A33C` |
| Error accent | `#D14B3C` | `#F0685A` |

The stylesheet includes separate tokens for secondary/placeholder text, readable links, a solid focus outline and a stronger control boundary. Use these for functional UI. Decorative borders and status accents alone do not guarantee accessible contrast.

Use `--sv-text-secondary` for labels, hints, metadata and placeholders on the standard background or panel surface. On tinted or muted surfaces, check contrast and use `--sv-text` when needed. Orange `#FF3F0A` on white is approximately 3.52:1, so it is unsuitable for normal-sized text. Use `--sv-link` for text links and underline links in prose. Keep status copy in `--sv-text`; accompany any color with a label or icon. Measure actual foreground/background combinations, including hover, selected and translucent states.

### Typography

| Use | Contract |
| --- | --- |
| Body, headings, controls | `"Helvetica Neue", "Helvetica", "Arimo", Arial, system-ui, -apple-system, sans-serif` |
| Optional large display text | `"Bebas Neue", "Arimo", system-ui, sans-serif` |
| Body | 14.5px, 400, line-height 1.55 |
| Secondary text / controls | 13px, 400–600, line-height 1.55 |
| Metadata | 12.5px, readable secondary color |
| Page heading | 28–32px, 600, line-height 1.2 |
| Section heading | 23px, 600, line-height 1.3 |
| Small panel heading | 15–18px, 600, line-height 1.3 |
| Optional hero | Up to 64px, Bebas Neue 400, line-height 1.04, tracking .01em |

Use compact headings on dense working screens and larger headings on directory pages. Reserve Bebas Neue for an optional landing-page headline; use the neutral font for all working screens. Keep uppercase for short optional eyebrow labels. Use at least the metadata size above for important instructions and metadata.

The stack works with system fallbacks. Arimo and Bebas Neue may be supplied as licensed, self-hosted webfonts by the implementation team, with license notices. A text “SlideVault” mark is sufficient for the application shell.

### Spacing, shape and motion

Use a 4px spacing grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56 and 64px. Typical working-page gutters are 20px at small widths and 40px at larger widths. Typical cards use 20px padding and 16px gaps; generous landing-page spacing should not make working screens inefficient.

| Role | Radius |
| --- | --- |
| Buttons, standard fields and icon tiles | 11px |
| Cards | 16px |
| Large search/composer input | 18px |
| Dialogs and larger panels | 24px |
| Pills | 999px |

Use soft shadows from the supplied tokens. The 18px input radius is for large search/composer surfaces; a conventional 40–44px form field can use the 11px control radius. Default controls are approximately 40px high, compact controls 36px and large controls 44px. Give frequent touch actions at least a 44px hit area even when the visible icon is smaller.

Transitions use 150ms for small interactions, 220ms for ordinary state changes and up to 320ms for a drawer. Honor reduced-motion preferences, keep progress understandable without animation and avoid decorative infinite motion. The stylesheet supplies reduced-motion duration values, but components must also remove repeating animations and smooth scrolling when appropriate.

## Reusable UI patterns

Implement a small local set of primitives with semantic props and documented states. Reuse them across the product so visual changes remain consistent.

| Primitive | Expected appearance and behavior |
| --- | --- |
| Button | Neutral primary, outlined secondary, quiet ghost and explicit destructive variants. Include keyboard focus, disabled and pending states. Prevent duplicate submissions and retain the action label while pending. |
| Form field | Persistent visible label, associated control, hint or error below it. Connect descriptions programmatically; expose required and invalid state. Do not rely on a placeholder for the label. |
| Search field | Search icon, clear action when populated, readable query and feedback. Distinguish “no results” from “nothing uploaded yet”. |
| Card | 16px radius, surface background, subtle border and shadow, 20px padding. A small hover lift is optional. Primary card navigation is a real link or button, with separate secondary actions. |
| Status chip | Compact text label with an optional decorative dot. Status is understandable without color. Avoid all-caps microtext for long processing labels. |
| Table/list | Native table or list semantics, clear headings and real row actions. Sort controls state their direction. Keep critical identifiers visible; show full truncated names on focus as well as hover. |
| Menu / select | Keyboard-operable trigger, options and selected state. Support Escape, focus return and the appropriate arrow-key behavior for the chosen pattern. |
| Dialog / drawer | Accessible title, description when needed, focus containment while modal, Escape where safe, explicit close action and focus return. Content scrolls without hiding its controls. |
| Feedback | Inline recoverable errors with retry/context, polite status announcements for long jobs, and success only after confirmed completion. |

Use consistent monochrome outline icons. Lucide is recommended for controls. Material Symbols Outlined at weight 300 is an alternative if used consistently; select one family for each UI role and avoid adding further families. Use icon labels for important actions, accessible names for icon-only buttons and `aria-hidden` for decorative glyphs.

## SlideVault screen guidance

These views map to the supplied mockup. Their presence here does not expand the product scope or make simulated interactions functional; the product specification and delivery plan determine what ships in each phase.

| View | Design contract |
| --- | --- |
| Home / search | One clear search entry point, optional suggested queries and recent content. Keep the useful input visible without a large promotional hero. |
| Library | Deck/storyboard navigation, search and filters, grid/list views if in scope, readable metadata, processing state and clear item actions. |
| Pages / slide results | Thumbnails, source deck and slide number, useful extracted labels, selection state and an ordered assembly tray. Make selected count and export availability visible. |
| Upload | A browse-file button as well as drag-and-drop, supported formats and limits before selection, real per-file upload/processing state, actionable failures and duplicate handling. |
| Deck detail | Deck metadata and slides, source provenance, processing status and available actions. Preserve thumbnail aspect ratios and reveal full titles. |
| Slide detail | Large preview, accessible text/metadata, provenance, selection and editing actions within the agreed scope. |
| Create / storyboard | Steps with named outcomes, clear save state, ordered sections/tiles, ownership and attachment information, and keyboard alternatives to reordering gestures. |
| Attachment picker | Search, deck navigation, explicit multi-selection, selected count, preview and a named commit action. Support range selection as an enhancement, not the sole mechanism. |

Keep source previews inside `object-fit: contain` or an equivalent fit mode when the whole slide must be visible. Do not assume all slides are 16:9 or 4:3. Label a cropped decorative thumbnail and open the complete slide for review. Expose the slide title and source as text; preview images must not be the only source of task-critical information.

Every asynchronous view needs designed states for initial loading, empty library, no matching results, pending work, partial failure, recoverable error and success. Show an accurate stage when available; do not invent percentages. Preserve the user's query, filters, selection and unsaved edits through recoverable failures. If permissions change or an item becomes unavailable, explain the loss of access without leaving an unusable blank panel.

Selection and navigation are separate actions. Keep selections stable across filtering when that is the chosen product behavior, display how many selected items are outside the current view, and provide “Clear selection”. The assembly order must be explicit and operable by keyboard. A failed export must preserve that order and selection for retry.

## Responsive layout

Use a fluid content area with a typical maximum width of 1320px. Workspace content must fit its parent container. Use `min-width: 0` on flexible children and adapt layout to available content width.

**Recommended verification widths:** 360px, 768px and 1280px of available workspace width, plus a narrow container inside a larger page. These are test fixtures, not fixed breakpoints.

- Collapse multi-column detail views and wizard sidebars into a readable sequence at narrow widths.
- Let toolbars wrap and filters move into an accessible drawer or disclosure.
- Use a single card column when a multi-column grid no longer fits. Avoid fixed 300px minimums that overflow small containers with gutters.
- Use horizontal scrolling only for content that needs a two-dimensional layout, such as a data table; surrounding navigation and actions must remain usable.
- Drawers should fit the available width. Avoid fixed-position trays that obscure surrounding navigation or silently trap the user in nested scrolling.
- Verify zoom and long content: deck titles, translated labels, file names, errors and large result counts.

## Accessibility acceptance

**Recommended quality target:** WCAG 2.2 AA for the delivered tool. Inspect rendered states and test the workflows to verify accessibility.

- Use at least 4.5:1 text contrast for normal text and 3:1 for qualifying large text. Placeholder text also needs sufficient contrast. [W3C: Contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Ensure necessary control boundaries, icons and visual state indicators have at least 3:1 against adjacent colors. Decorative card dividers may remain subtle. Use the stronger control-border token where a boundary is needed to identify an input. [W3C: Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- Give every interactive element a visible focus indicator. A recommended implementation is a 2px solid `--sv-focus` outline with 2px offset, adjusted to remain visible against the actual surrounding surface. Do not use only a translucent orange glow.
- Meet WCAG target-size requirements, including the 24-by-24 CSS pixel minimum or applicable spacing/other exceptions. Prefer the larger touch target above. [W3C: Target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Complete search, upload, selection, reordering, editing and export with a keyboard. Do not make a clickable table row or a drag gesture the only route to an action.
- Use semantic headings and landmarks, named buttons and inputs, visible labels, clear validation and predictable focus. Announce job status without repeatedly interrupting the user.
- Review focus, selected, hover, error and disabled states in both themes. Test reduced motion and a screen reader through the primary workflow.

## Review evidence

At each UI milestone, provide screenshots of the agreed key screens in both themes and at the verification widths, a short keyboard walkthrough, and a list of remaining gaps. Include empty/error/processing states, not only populated mock data. Review at least one real authorized sample deck with different slide dimensions and long metadata. Use synthetic fixtures in the repository; confidential sample content must stay in its approved test environment.

Update this contract and the token stylesheet together when a design decision changes. Record any intentional departure from the baseline with the reason and review outcome. Do not silently inherit older values or behavior from the HTML mockup.
