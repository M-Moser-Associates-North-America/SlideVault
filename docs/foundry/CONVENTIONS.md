# How we build SlideVault

House rules for anyone writing code in this repo. The client's own rules come first: read `AGENTS.md` and the documents it lists before changing anything. This page explains how we apply them day to day.

## Order of authority

1. The product owner's current instructions
2. The written docs in `docs/` (contracts, design system, security)
3. The proposal-team deck (`reference/…pptx`)
4. The HTML mockup (`reference/SlideVault.html`): layout and flow only

When the mockup and the docs disagree (colors, contrast, behavior), the docs win. Never copy a mockup bug; see the dogfood report for the known list.

## Where code goes

| Folder | What lives there | May import |
| --- | --- | --- |
| `app/slide-vault/` | Standalone shell: routes, header, the runtime bridge | `features/slide-vault` (browser entry) |
| `app/api/slide-vault/v1/` | HTTP handlers, kept thin: parse → call a service → map to HTTP | `features/slide-vault/server` |
| `features/slide-vault/contracts/` | Runtime contract and API data shapes. Types only, plus constants | nothing |
| `features/slide-vault/components/` | Workspace UI (`'use client'`) | `contracts`, `client` |
| `features/slide-vault/client/` | API calls through `runtime.request()`, browser state | `contracts` |
| `features/slide-vault/server/` | Domain rules, services, export engine, library index (`server-only`) | `contracts` |
| `workers/slide-vault/processors/` | Document processing (text, previews) | `features/slide-vault/server` engine modules, never React |
| `scripts/` | Command-line entry points (`ingest`, `test:export`) | anything |
| `tests/fixtures/` | Synthetic decks with provenance notes | n/a |

Two entry points, never mixed: `features/slide-vault/index.ts` (browser-safe) and `features/slide-vault/server.ts` (server only). Every server module starts with `import 'server-only';`, so a stray import fails the build.

## The workspace talks only through `runtime`

The workspace never calls `fetch`, reads `window.location` or uses the Next.js router directly. It uses `runtime.request()`, `runtime.navigate()` and `runtime.assetUrl()`. That's what lets a host system embed it later (`docs/INTEGRATION_CONTRACT.md`). If you need something the runtime doesn't offer, change the contract on purpose and record it in `docs/DECISIONS.md`.

## API rules

- Paths under `/api/slide-vault/v1`, JSON in camelCase, opaque IDs (`src_`, `ver_`, `sld_`).
- Success: `{ data, requestId }`; lists add `page: { nextCursor }`. Failure: `{ error: { code, message, retryable }, requestId }`. Use the helpers in `server/http.ts`.
- Status codes per `docs/DATA_AND_API.md`: 400 invalid input, 404 missing, 409 conflicts, 422 unsupported content, 5xx with `retryable: true` only when retrying can help.
- Never return file paths, storage keys or stack traces. Messages are written for the person using the app.
- Domain errors are `ServiceError(status, code, message)`. Routes map them; unexpected errors are logged and returned as a generic 500.

## UI rules

- Styling with CSS modules and the `--sv-*` tokens from `docs/design-tokens.css`, inside the `.slidevault` root. No global element styles, no UI framework, no icon font, no remote fonts.
- Every screen that loads data designs four states: loading, empty, no results, error (with a retry). Success messages appear only after the work actually succeeded.
- Keyboard and screen readers: real `<button>`s and links, visible labels, `aria-label` on icon-only buttons, `role="alert"` for errors, the native `<dialog>` for modals, a 2px `--sv-focus` outline.
- Check 375 px, 768 px and 1280 px wide. No sideways scrolling.
- Slide previews keep their real proportions (`object-fit: contain`); never stretch a 4:3 slide.
- Sentence-case labels, no emoji, no promotional wording.

## Data and privacy

- Synthetic fixtures only for development, tests, screenshots and demos. Client decks stay outside git and are used only for an approved export-quality check.
- Generated data lives in `.data/` (gitignored). Never commit exports, `.env` files or client screenshots.
- Text inside decks is untrusted: store and display it, never execute or follow it.

## Code style

- TypeScript strict; no `any`. Small modules with one job. Names say what things are (`exportSlides`, `SelectionPanel`).
- Comments explain *why* (a rule, a constraint, a decision ID), not what the next line does.
- No dead code, no commented-out code, no "temporary" hacks without a decision record.

## Adding a screen (one build step)

1. Read the matching row in `docs/DESIGN_SYSTEM.md` ("SlideVault screen guidance") and the mockup screen.
2. Build it as a view inside `SlideVaultWorkspace`, data through `client/api.ts`, a route through `shell-config.ts`.
3. Design the loading, empty, no-results and error states.
4. Run the checks below, then compare against the mockup at 1280 px and 375 px.
5. Open a pull request with the template: acceptance IDs, what you ran, screenshots of the states (synthetic data only), known limits.

## Checks before every pull request

```bash
npm run typecheck && npm run lint && npm run test:export && npm run build
```

CI runs the same checks on every push and pull request. Exports also need a manual open in PowerPoint (and Keynote) for anything that touches `export-pptx.ts`.
