# The slide record

Locked in with the team 2026-10-12, matching `supabase/migrations/20261012223330_align_to_team_slide_record.sql`. These are the real, live column names in Postgres today, verified by uploading an actual deck end to end through `POST /uploads`.

## Deck record (`decks` table)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Generated on insert |
| `client` | text | From the folder path |
| `year` | integer? | From the folder path |
| `category` | text? | IDD, Business Proposal, SME, or unset (shown as "unknown" by the screens, not stored as the literal string) |
| `title` | text | File name without `.pptx` |
| `source_path` | text | The original folder path, kept for traceability |
| `source_filename` | text | The original filename, unchanged. Not in the team's original list -- kept as a small, additive field alongside `title`, doesn't conflict with anything |
| `file_path` | text | Where the untouched original lives in the `slide-originals` storage bucket |
| `file_hash` | text, unique | SHA-256 of the original bytes. Duplicate uploads are rejected by this, not the filename -- confirmed live: re-uploading the same file returns 409 |
| `source` | `upload` \| `sharepoint` | Always `upload` today |
| `best_of_the_best` | boolean | Default false |
| `slide_count` | integer | Set once processing finishes |
| `slide_size` | text | `16:9` or `4:3`, read from the deck itself |
| `status` | `queued` \| `processing` \| `ready` \| `failed` | |
| `error` | text? | Plain-language reason when status is `failed` |
| `uploaded_at` | timestamptz | |

## Slide record (`slides` table)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Generated on insert |
| `deck_id` | uuid | Which deck it belongs to |
| `slide_number` | integer | Position in the original deck, starting at 1 |
| `title` | text? | First line of text, or empty |
| `text` | text? | All text on the slide |
| `notes` | text? | Speaker notes -- column exists, not populated by the upload path yet |
| `thumbnail_path` | text? | Preview PNG in the `slide-previews` storage bucket |
| `is_hidden_in_source` | boolean | **Not in the team's original list.** Added back deliberately: this is a feature that already works and was tested (the "Hidden in source" badge in both the rebuild and Sean's POC). Flagged to the team when added; dropping it would have been a silent regression, not a simplification. |
| `slide_type` | text? | AI-suggested later, empty until then |
| `description` | text? | AI-suggested later |
| `sector` | text? | AI-suggested later |
| `tag_status` | `suggested` \| `approved` \| null | Null until an AI suggestion exists |

## What's actually wired up today (2026-10-12)

- `POST /uploads` (multipart: `file`, `clientName`, `deckYear`, `category`, `folderPath`, `bestOfTheBest`): stores the original unchanged in Supabase Storage, splits it with the existing extract/render pipeline (same code as `npm run ingest`, not rewritten), and writes `decks`/`slides` rows. Runs synchronously in the request, the same accepted shortcut as export (`DECISIONS.md` FD-03) -- not a job queue yet.
- `GET /search` now queries both the synthetic-fixture JSON index and Postgres, and concatenates results. They aren't merged into one cursor-paginated system yet -- today's bar was an uploaded deck's slides actually showing up in search, not full cross-source pagination correctness.
- `GET /slides/:id` and `GET /slides/:id/preview` check the fixture index first, then Postgres/Storage.
- The export engine (`export-pptx.ts`) was not touched at all -- still the version tested against Sean's, still passing all 29 checks in `npm run test:export`.

## Bug found and fixed while wiring this up

The first version of this migration (applied earlier) was missing the `category` column entirely -- referenced in application code and discussed with the team, but never actually added to the table. Caught by testing `POST /uploads` against the real live database rather than by code review; fixed in `20261012224200_add_missing_category_column.sql`. Worth remembering for next time: a schema matches the agreement only once something has actually been pushed through it end to end, not once the migration file looks right.

## Still open

- AI-suggested `slide_type`/`description`/`sector`/`tag_status` -- not populated yet, waiting on D-12 (AI provider + permission to process M Moser's slide content).
- `notes` (speaker notes) -- column exists, extraction not wired into the upload path yet.
- Ingest-reads-subfolders (deriving `client`/`year`/`category`/`best_of_the_best` from a real folder tree instead of form fields) -- Vincent's piece, plugs into the same `processUpload` function.
- Duplicate grouping (built in PR #5, `npm run test:duplicates`) -- not wired into search yet.
