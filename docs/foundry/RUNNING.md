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
npm run ingest    # read the reference deck → thumbnails + slide list (first time, or when the deck changes)
npm run dev       # start the app → open http://localhost:3000
```

After re-running `npm run ingest`, restart `npm run dev` to see the new slide list.

## Checks to run before opening a pull request

```bash
npm run test:export   # 20 checks on the exported PowerPoint itself
npm run typecheck     # TypeScript, strict
npm run lint
npm run build
```

## What it does

1. **Library**: every slide of `reference/SlideVault_Presentation1_Aug5.pptx` with a real thumbnail, including the 2 slides hidden in the source.
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

- **One source deck.** Combining slides from several decks into one export is the client's first proof test (Gate 0) and the next big piece of work.
- **Each slide once per export.** Repeating a slide is rejected with a message for now.
- **No upload yet.** The library is built from the reference deck by `npm run ingest`.
- **No login.** Run it locally; don't host it publicly with client content.
- **Thumbnail fonts.** The deck's brand fonts (Untitled Sans, Bebas Neue) aren't installed, so thumbnails use Arial / Arial Narrow. Exported files keep the original fonts.
- **Selection is per browser.** Saved, shareable selections need a database (client criterion PR-06).
- Verified in Keynote and LibreOffice; please also open an export in Microsoft PowerPoint.

## Where things are

```text
app/library/page.tsx                         the page (application shell)
app/api/export/route.ts                      export endpoint (thin)
features/slide-vault/components/             the workspace UI (browser)
features/slide-vault/server/export-pptx.ts   builds the export (server only)
features/slide-vault/server/library.ts       loads the ingested slide list
scripts/ingest.mts                           builds thumbnails + slide list from the deck
scripts/test-export.mts                      export acceptance checks
```
