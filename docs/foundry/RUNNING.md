# SlideVault prototype: how to run it

Team build by The Foundry. This is a rebuild of the first proof of concept (the slide library + editable PowerPoint export) inside our private repo, with the issues found in testing fixed.

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

After re-running `npm run ingest`, restart `npm run dev` to see the new slide list.

## Checks to run before opening a pull request

```bash
npm run test:export   # 29 checks on the exported PowerPoint itself
npm run typecheck     # TypeScript, strict
npm run lint
npm run build
```

## What it does

1. **Library**: every slide of every deck in the library folder (by default the synthetic decks in `tests/fixtures/`) with a real thumbnail, including slides hidden in the source.
2. **Search**: every word must appear in the slide's title or text ("content canonical" finds slides with both words). Clear empty state.
3. **Preview**: large slide, source deck and slide number, trust fields (owner / approval / review date shown as "Unknown" until curation exists), full slide text. Escape or clicking outside closes it.
4. **Selection**: select / remove, reorder with labeled ↑ ↓ buttons, clear. Kept across reloads in your browser.
5. **Export**: downloads `SlideVault-export.pptx` containing **only** the selected slides, in the selected order, as editable PowerPoint.

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

- **One deck per export.** The library holds several decks, but an export must come from one of them (clear message otherwise). Combining decks is the client's first proof test (Gate 0) and the next big piece of work.
- **Each slide once per export.** Repeating a slide is rejected with a message for now.
- **No upload yet.** The library is built by `npm run ingest` from `SLIDEVAULT_LIBRARY_DIR` (default `tests/fixtures`). Real client decks are only used for an approved export-quality check and never committed.
- **No login.** Run it locally; don't host it publicly with client content.
- **Thumbnail fonts.** Brand fonts that LibreOffice can't use (e.g. Untitled Sans, Bebas Neue) are mapped to Arial / Arial Narrow for thumbnails only. Exported files keep the original fonts.
- **Selection is per browser.** Saved, shareable selections need a database (client criterion PR-06).
- Verified in Keynote and LibreOffice; please also open an export in Microsoft PowerPoint.

## Where things are

```text
app/slide-vault/                             standalone shell: routes, runtime bridge (navigation, API, theme)
app/api/slide-vault/v1/                      HTTP API (thin handlers)
features/slide-vault/contracts/              runtime contract + API data shapes (shared)
features/slide-vault/components/             the workspace UI (browser)
features/slide-vault/client/                 API calls via the runtime, selection store
features/slide-vault/server/                 export engine, library index, services (server only)
workers/slide-vault/processors/              slide text extraction, preview rendering
scripts/ingest.mts                           builds .data/ from the library decks
scripts/test-export.mts                      export acceptance checks
tests/fixtures/                              synthetic decks (see its README)
```
