# SlideVault: how to run it

Team build by The Foundry. It started as a rebuild of the first proof of concept (slide library + editable PowerPoint export) and now includes search with an optional AI reader, combined exports, per-person saved data and an upload tool. Why each choice was made is in `docs/DECISIONS.md` (FD-01 onward).

## Run it on your laptop

You need, once per machine:

- **Node.js 22 or newer** — check with `node -v`
- **LibreOffice** — `brew install --cask libreoffice` (makes the slide thumbnails)
- **poppler** — `brew install poppler` (turns the rendered deck into images)
- **Ollama** (only for meaning search) — download from ollama.com, then `ollama pull nomic-embed-text` (free, runs on your laptop, about 270 MB)

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
- **Meaning search** (`SV_EMBED_*`, FD-55): finds slides close in meaning even when they never use the words searched for. Off while `SV_EMBED_MODEL` is empty, and keyword search works the same either way. See "Turning on meaning search" below.

### Turning on meaning search

Each slide gets a meaning fingerprint (an embedding: a list of 768 numbers) stored with pgvector in M Moser's own database. A search is turned into a fingerprint the same way, and the closest slides are added after the keyword results.

1. **pgvector, once per database (the project owner).** Switch on the `vector` extension in Supabase, then run in the SQL editor:
   ```sql
   grant usage on schema "extensions" to slidevault_developer;
   ```
   (Done on M Moser's project on 31 Oct 2026.)
2. **The model.** Start Ollama (the app, or `ollama serve` in its own Terminal tab) and check `ollama list` shows `nomic-embed-text`. In `.env.local`:
   ```bash
   SV_EMBED_BASE_URL=http://localhost:11434/v1
   SV_EMBED_MODEL=nomic-embed-text
   ```
   Any OpenAI-style `/embeddings` endpoint works too, with `SV_EMBED_API_KEY`.
3. **The table and the fingerprints.**
   ```bash
   npm run db:vector               # checks pgvector and the grant, creates slide_embeddings (safe to re-run)
   npm run embed:slides            # dry run: checks the model answers, counts the slides to do
   npm run embed:slides -- --yes   # makes them (all 1,874 real slides took under 4 minutes on a laptop)
   ```
4. **Keep them current.** Decks uploaded in the app get their fingerprints automatically a few seconds after saving (FD-82), as long as the app has the same `SV_EMBED_*` settings and the model is running. After slide text changes, after loading decks with a script, or if the model was down during an upload, run `npm run embed:slides -- --yes` again. It only redoes slides whose words changed. Changing the model means running it again; nothing else changes.

Ollama has to be running while the app runs. If it isn't, meaning search steps aside quietly and search is keyword only. Two settings tune it: `SV_MEANING_MIN_SIMILARITY` (how close a slide must be, default 0.55) and `SV_MEANING_MIN_WORDS` (slides with fewer words of their own and no story reading are never added by meaning, default 4, so blank or photo-only slides don't show up).

## Looking after the library (M Moser's Supabase)

Every command below reads your personal `SV_DB_*` login from `.env.local`. The ones that change data do a dry run first and only change anything with `--yes`. M Moser's storage bucket can't delete or overwrite files, so a deck uploaded by mistake is archived, not removed.

```bash
npm run db:check                                          # read-only: can my login reach the tables, storage and pgvector?
npm run db:setup                                          # creates or updates the tables (safe to re-run)
npm run upload:library -- <folder> --dry-run              # lists what would be uploaded; then --yes (add --as "Your Name")
npm run deck:unstick -- "part of the title"               # a deck stuck at "processing" after an interrupted upload
npm run deck:archive -- "part of the title"               # hide a test or wrong deck (--yes to do it, --undo --yes to bring it back)
npm run deck:details -- <folder of the deck files>        # who created each deck and when, read from the files
npm run story:import -- --export <folder> --data <folder> --csv <file>   # the team's story tags and readings (FD-51)
npm run slides:spacing -- <folder of the deck files>      # puts back spaces lost at line breaks in decks uploaded before 31 Oct
npm run embed:slides -- --yes                             # meaning fingerprints for new or changed slides
```

Real decks, real client data and anything exported from the database stay out of the repo (keep them in a folder outside it). Never commit `.env.local`.

## Checks to run before opening a pull request

The tests marked "local test database only" skip themselves unless `SV_DB_HOST=localhost` and `SV_DB_SSL=disable`, so they can never touch M Moser's real data. They create and drop their own tables.

```bash
npm run typecheck        # TypeScript, strict
npm run lint
npm run test:export      # checks on the exported PowerPoint itself
npm run test:combine     # several decks combined into one .pptx
npm run test:duplicates  # duplicate grouping on the SharePoint-style library
npm run test:folder-path # client, year and category read from folder names
npm run test:extract     # reading words out of slides (line breaks are spaces)
npm run test:deck-details
npm run test:deck-finder
npm run test:smart-search  # AI reader adapter, filters, fallbacks, rate limits (fake API, no network)
npm run test:reasoning-map
npm run test:storyboard
npm run test:story-learning
npm run test:deck-suggestions
npm run test:upload-preview
npm run test:user-data   # per-person data; needs a local Postgres set up like M Moser's
npm run test:packs       # packs, archive, deck details; local test database only
npm run test:tags        # free tags; local test database only
npm run test:search-context  # kind, sector, theme and tags in search; local test database only
npm run test:meaning     # meaning search; local Postgres with pgvector only (runs its own stand-in model)
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
7. **Upload**: the Upload screen previews every slide before anything is saved, lets you add tags to the deck or to single slides, then adds it to the library (FD-54). Nothing reaches the database or storage until you confirm. `npm run upload:library` loads a folder of decks.
8. **Quick tour** on first sign-in, replayable from the header (React Joyride, FD-19).
9. **Search that knows the slides**: story tags (what each slide shows and which part of the story it serves), slide kind, sector and theme rank results (FD-51, FD-70); slides people tagged come first; Useful / Not relevant feedback; meaning search adds slides close in meaning (FD-55).
10. **Packs, archive, tags**: slides that only work together are suggested as packs to confirm or dismiss; decks can be archived and restored (hidden from the app, search and AI, never deleted); people add their own free tags (FD-52, FD-53). Who did each is recorded.
11. **Suggested for you** follows the person's role, counted by role and never by name (FD-71).
12. **Storyboard**: describe the client's situation and SlideVault lays out a story from the library's slides.

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
- **Who did it is "Person A" for now.** Archive, packs, tags and uploads record the signed-in name, which is the stand-in profile until M Moser's login replaces it (`server/principal.ts`). Who may archive, confirm packs or tag is an approval-tier decision for M Moser; anyone signed in can for the MVP.
- **Meaning search needs a running embedding model.** New uploads get their fingerprints automatically when the model is running; if it was down, `npm run embed:slides -- --yes` catches them up (keyword search finds them straight away either way). Tag suggestions use the same fingerprints, so a slide without one gets no suggestions.
- **Local test decks.** If you once ran `npm run ingest`, the synthetic decks in `.data/library.json` show next to the real library on your laptop only. Rename that file to hide them for a demo.
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
