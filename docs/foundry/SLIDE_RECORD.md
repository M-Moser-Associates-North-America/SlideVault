# The slide record

What Vincent's Python worker hands off, what Lola's backend stores in Postgres, and what Khushali's frontend reads. One shape, used by all three pieces, so nobody translates field names by guesswork.

**Open question for the 30-minute sync:** the Oct 8 recap to Alina only described folders by **client and year**. The Oct 10 plan adds a third folder level, **category**. Confirm with the group whether `category` is really a folder-path segment (e.g. `client/year/category/deck.pptx`) or whether it's the same idea as the content-type labels (About us / Values / Case study / Team) already in the schema, just derived from the folder name instead of suggested by AI. Those are two different things to build. Write the answer here once agreed.

## Deck record

One row per uploaded `.pptx` file. Matches the `decks` table in `supabase/migrations/20261010170624_init_slide_vault.sql`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Generated on insert |
| `clientName` | string | From the folder path |
| `deckYear` | integer | From the folder path |
| `category` | string? | **Open — see above** |
| `title` | string | Deck title, from the filename or first slide |
| `folderPath` | string | The original path, kept for traceability |
| `sourceFilename` | string | Original filename, unchanged |
| `sourceStorageKey` | string | Where the untouched `.pptx` lives in Supabase Storage (`slide-originals` bucket) |
| `fileSha256` | string | Hash of the original bytes; duplicate uploads are detected by this, not the filename |
| `status` | `queued` \| `processing` \| `ready` \| `failed` | Set by the backend; `ready` only once the worker has finished every slide |

## Slide record

One row per slide, written by the worker after it splits a deck. Matches the `slides` table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Generated on insert |
| `deckId` | uuid | Foreign key to the deck |
| `slideNumber` | integer | 1-based, original position in the source file |
| `title` | string? | Extracted from the slide, may be empty |
| `extractedText` | string? | All visible text on the slide, used for keyword search today and AI search later |
| `previewStorageKey` | string? | PNG/thumbnail path in the `slide-previews` bucket |
| `isHiddenInSource` | boolean | True if the slide was marked hidden in the original PowerPoint |

## Worker-to-backend handoff (today, Oct 10/11)

The worker does not write to Postgres directly. It processes one deck and hands the backend a plain JSON result; the backend is the only thing that writes to the database. Proposed shape for Sunday's upload endpoint:

```json
{
  "deckId": "uuid-the-backend-already-created-at-upload-time",
  "slides": [
    {
      "slideNumber": 1,
      "title": "Harbor Bank: headquarters consolidation",
      "extractedText": "Proposal prepared by Northwind Studio",
      "previewStorageKey": "slide-previews/<deckId>/0001.png",
      "isHiddenInSource": false
    }
  ]
}
```

The backend creates the `decks` row first (status `queued`), stores the original file, then triggers the worker with the deck's storage key. The worker posts the result above back to a backend endpoint, which inserts the slide rows and flips the deck to `ready` (or `failed` with a reason).

## What's deliberately not here yet

Content-type labels (`labels` / `slide_labels` tables) exist in the migration but aren't part of today's build — they're Wednesday-and-later work per the plan. Don't wire the worker to suggest labels yet; just get text, slide number, and folder info flowing end to end first.
