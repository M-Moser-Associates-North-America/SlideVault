# SlideVault: how to run it

Team build by The Foundry. It started as a rebuild of the first proof of concept (slide library + editable PowerPoint export) and now includes search with an optional AI reader, combined exports, per-person saved data and an upload tool. Why each choice was made is in `docs/DECISIONS.md` (FD-01 to FD-21).

## Run it on your laptop

You need, once per machine:

- **Node.js 22 or newer** — check with `node -v`
- **LibreOffice** — `brew install --cask libreoffice` (makes the slide thumbnails)
- **poppler** — `brew install poppler` (turns the rendered deck into images)

Then, from the repo folder:

```bash
npm ci            # install exact dependency versions (first time, or after pulling changes)
npm run ingest    # read the library decks → .data/ (first time, or when decks change)
npm run dev       # start the app → open http://localhost:3000/slide-vault
```

With no settings it runs on the synthetic decks in `tests/fixtures/` and keeps saved slides and drafts in the browser. After re-running `npm run ingest`, restart `npm run dev` to see the new slide list.

### Optional settings (`.env.local`, see `env.example`)

- **Database** (`SV_DB_*`, `SV_SUPABASE_*`, `SV_STORAGE_*`): M Moser's Supabase project through a personal login, no master key (FD-12). `npm run db:setup` creates the tables, `npm run db:check` checks access read-only. With a database, search reads Postgres, and saved slides, drafts, opt-in activity and download counts are kept per person on the server (FD-18).
- **AI reader** (`SV_AI_*`): off by default (`SV_AI_PROVIDER=none`). `openai-compatible` works with OpenAI or a local model such as Qwen3 through Ollama (FD-17). Changing provider needs no UI or database change.

## Checks to run before opening a pull request

```bash
npm run typecheck        # TypeScript, strict
npm run lint
npm run test:export      # checks on the exported PowerPoint itself
npm run test:combine     # several decks combined into one .pptx
npm run test:duplicates  # duplicate grouping on the SharePoint-style library
npm run test:folder-path # client, year and category read from folder names
npm run test:deck-details
npm run test:smart-search  # AI reader adapter, filters, fallbacks, rate limits (fake API, no network)
npm run test:user-data   # per-person data; needs a local Postgres set up like M Moser's
npm run build
npm run test:a11y        # accessibility (axe-core + keyboard), needs `npm run ingest` and `npm run build` first
```

## What it does

1. **Library**: every slide of every deck, with a real thumbnail, grouped by client, year, category and deck. Client, year and category come from the folder path (FD-11, FD-13).
2. **Search**: short searches (four words or fewer, not a question) run as a plain keyword search and never call a model. A sentence or question submitted with Enter can be read by the configured AI reader into keywords and filters; with no reader, or if it fails, a rules-only reader does the same job. Each result says why it fits, built only from what matched on the slide (FD-16, FD-17). Searches, exports and uploads are rate-limited per caller.
3. **Preview**: large slide, source deck and slide number, step through the deck, full slide text.
4. **Draft deck**: tick slides, drag to reorder (works on touch screens), save as a named draft under My decks, download.
5. **Export**: only the selected slides, in order, as editable PowerPoint; speaker notes, comments and source author details are removed (FD-07). Slides from several decks come as a .zip of one .pptx per deck, or as one combined .pptx with each slide keeping its own design (FD-21). Decks with different slide sizes always come as a .zip.
6. **Saved slides, My decks, activity**: per person. Activity is recorded only after the person opts in, is used only for their own rows, and is deleted after 90 days or on opt-out (FD-18).
7. **Upload**: the Upload screen adds a .pptx to the library; `npm run upload:library` loads a folder of decks.
8. **Quick tour** on first sign-in, replayable from the header (React Joyride, FD-19).

## What changed from the first proof of concept

| Problem found in testing | Now |
| --- | --- |
| Export file secretly contained all 18 source slides | Only the selected slides are in the file; everything else is removed |
| Export carried the M Moser author name, slide-title list and cover thumbnail | Replaced with neutral "SlideVault" properties; thumbnail removed |
| Speaker notes and reviewer comments travelled with exports | Left out by default |
| 5 MB file for 3 slides | ~125 KB for the same 3 slides |
| Slide 12 thumbnail blank; titles like "Role &" | All 18 thumbnails render; titles read correctly |
| Escape didn't close the preview | Native dialog: Escape and click-outside close it |
| Failed export failed silently | Clear error message; selection is kept |
| Bad slide number crashed the server (500) | Clear 400 message |
| Selection lost on reload | Kept |
| Unlabelled ↑ ↓ × buttons | Labelled for screen readers; visible focus outline |
| Code lived only on a personal server | Lives in the team repo |

## Known limits (next steps)

- **No real sign-in.** The sign-in screen is a stand-in. Until M Moser's login plugs in, the server reads the person's name from the `X-SlideVault-User` header (`server/principal.ts`), which keeps people's data apart for testing but is not security. Don't host it publicly with client content.
- **No per-person deck access yet.** Everyone who can open the app can see every deck.
- **Each slide once per export** (FD-05).
- **Rate limits live in one server process.** A multi-instance deployment needs a shared store or the host's gateway limits (FD-17).
- **Thumbnail fonts.** Brand fonts LibreOffice can't use (e.g. Untitled Sans, Bebas Neue) are mapped to Arial / Arial Narrow for thumbnails only. Exported files keep the original fonts.
- **Still to do from the front-end review:** split `components/Views.tsx` and the workspace context by responsibility, and fold `slidevault.css` and `slidevault-extras.css` into component-owned rules.
- **Next:** hidden-in-source slides left out of search by default and archiving decks (FD-27); the storyboard; deck facts suggested from the file on upload; meaning search with pgvector.
- Verified in Keynote and LibreOffice; please also open an export in Microsoft PowerPoint.

## Where things are

```text
app/slide-vault/                             standalone shell: routes, runtime bridge (navigation, API, theme)
app/api/slide-vault/v1/                      HTTP API (thin handlers), including /smart-search and /me/*
features/slide-vault/contracts/              runtime contract + API data shapes (shared)
features/slide-vault/components/             the workspace UI (browser)
features/slide-vault/client/                 API calls via the runtime, selection and profile stores
features/slide-vault/server/                 export and combine engines, library index, rate limits (server only)
features/slide-vault/server/ai/              provider-neutral AI reader and the OpenAI-compatible adapter
features/slide-vault/server/services/        search, smart search and export services
features/slide-vault/server/sql/schema.sql   database tables (npm run db:setup)
workers/slide-vault/processors/              slide text extraction, preview rendering
scripts/                                     ingest, upload, database setup and the test suites
tests/fixtures/                              synthetic decks (see its README)
```
