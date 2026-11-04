# Data and API contract

**Status:** recommended v0.1 design, now partly built. The endpoints that exist, and where they differ from this design, are listed under [As built (2026-11-02)](#as-built-2026-11-02); the shared TypeScript DTOs are in `features/slide-vault/contracts/dto.ts`. No OpenAPI schema is published yet (Gate 1 asks for one). The original design text below is kept as the target. Scope follows [Product brief](PRODUCT_BRIEF.md); provider choices remain in [Decisions](DECISIONS.md).

## Domain model

Use opaque IDs, UTC timestamps, explicit foreign keys and unique constraints. Prefix tables with `sv_` or use a dedicated private schema; choose one convention at Gate 1. A `library` is the access boundary; no firm-wide, office-wide or project-wide access is implied until configured.

| Entity | Minimum data and invariants |
| --- | --- |
| Library | ID, name, policy configuration. Every content record belongs to one library; moving libraries is an explicit authorized operation. |
| Membership | Library ID, verified subject ID, granted actions. Unique pair. Resolve effective membership through a replaceable authorization adapter. |
| Source deck | ID, library ID, title, owner subject, content class, origin kind, optional external reference, latestVersionId, currentApprovedVersionId, row revision, created/updated timestamps. Latest upload and approved usable version are separate pointers. |
| Source version | ID, source ID, immutable version number, SHA-256 of original, private object key, original filename/MIME/bytes, origin modification time, import time, pipeline version, processing state. Never replace source bytes in place. |
| Slide | ID, source version ID, original one-based slide number, title/text, original dimensions/aspect ratio, private preview key, row revision, supported-export status and warnings. Unique `(sourceVersionId, slideNumber)`. Reimport creates new versioned slide IDs. |
| Content review | Exact sourceVersionId or versioned slideId, class (`canonical`, `reusable`, `one_off`), state, owner, reviewer, review time/due date, restrictions, decision reason. Store review history separately from processing state. A source-level review is always bound to the reviewed version, never merely the mutable source ID. |
| Canonical slot | Library ID, subject key, approved variant key (e.g. locale), current approved version/slide reference. Unique slot; swapping the current pointer is transactional and audited. |
| Tag / tag link | Controlled taxonomy, normalized value, origin (`human`/`suggested`), suggestion provenance and reviewer. Model suggestions do not overwrite approved tags. |
| Collection / item | Creator, library, title, row revision and ordered item IDs. Each item references an exact slide/version; duplicate use is an explicit ordered occurrence. An initial collection stays within one library. |
| Upload session | Principal/library, generated object key, expected bytes/type/hash, expiry, completion state and idempotency key. No arbitrary object-key input. |
| Job | Kind, actor/library, input version references, status/stage/progress, attempt count, lease/heartbeat, cancellation request, safe failure code, output references, pipeline version, timestamps. |
| Export | Requester/library, ordered immutable slide references, fidelity policy, state/job, manifest, private output key, expiry, source permission/version snapshot for audit. Snapshot never substitutes for current access. |
| Audit event | Actor, action, object/version IDs, result, request ID, timestamp and safe change metadata. Never store document text, signed URLs or credentials in routine events. |

Store confidentiality and reuse restrictions as enforceable fields/policy references rather than decorative tags. Distinguish the original file's modified date, ingestion time and human review date. An AI-generated summary is not an approval or review.

Phase 2 adds storyboard, section, tile, assignment and attachment entities. A tile has a stable ID, section/order, title, notes, estimated page count, assignee reference and ordered attachments. Page budget is a soft warning. Library attachments point to exact versions; local uploads pass through the same private ingestion rules. Optional project references use opaque external IDs behind a project adapter. Use synthetic project choices for development; a full project or staff directory is outside the current scope.

## Lifecycle

**Processing:** `queued → validating → processing → ready`, with terminal `failed` or `cancelled`. Use `processing` stage detail for extraction/render/index. A source is ready only when its required outputs have been committed. On failure expose a safe reason and retry action; never leave a fake ready card. The last approved ready version remains usable while a replacement is processing.

**Review:** `draft → in_review → approved → retired`; a rejection returns to draft with a reason. Only authorized reviewers approve/retire. Replacing source bytes creates a new draft review; it does not inherit approval silently. Retirement stops new selection/export but preserves restricted audit history and visible warnings in existing collections.

**Canonical content:** default to one current approved version per subject/variant. The deck's suggestion of one or two versions becomes a controlled set of variants, not an arbitrary count of duplicate files. Decide which variants are valid at Gate 0. Replacement atomically updates the canonical slot and preserves prior lineage.

**Deletion:** distinguish source retirement from permanent deletion. Deletion revokes app access immediately, stops dependent jobs, invalidates caches/index entries and schedules source/derived/export object cleanup. Export manifests locate derived artifacts affected by deleted or newly restricted sources. Audit retention and physical purge timing are policy decisions, not silent defaults.

**Duplicates:** check file hashes within the caller's authorized library scope. Do not reveal the existence or title of an inaccessible matching source. An exact duplicate returns the existing authorized reference or asks for an explicit version/variant decision. Near-duplicate similarity is advisory and never auto-deletes content.

## Search and selection

Phase 1 uses extracted text and metadata search with controlled filters. Index only ready content eligible for the caller's view. Apply resource access before ranking, pagination, facet counts and snippets. Avoid global counts or autocomplete that leak private material. Normal search favors approved content; authorized contributors can explicitly include drafts. Exclude retired content by default.

Support content class, approval, source/deck, owner, reviewed date and agreed taxonomy filters. Keep cursor ordering deterministic with an ID tie-breaker. Return a bounded page (proposed default 24, maximum 100). Clear filters and no-result states must be distinguishable from failures. Search never invents a match or source citation.

A collection item pins the selected version. If a newer canonical version appears, show an explicit update option and preserve the user's order. Recheck restrictions at export time. Reordering uses item IDs and optimistic concurrency; a stale revision returns 409 rather than discarding another user's changes.

## As built (2026-11-02)

Every route below exists under `/api/slide-vault/v1` (one `route.ts` per path in `app/api/slide-vault/v1/`). Request and response shapes are the DTOs in `features/slide-vault/contracts/dto.ts`; each route's file says which decision (FD-…, `docs/DECISIONS.md`) set its behaviour. Responses use the `{ data }` / `{ error: { code, message, retryable } }` shapes described below.

| Endpoint | What it does | Decision |
| --- | --- | --- |
| `GET /session` | The caller's effective capabilities, and `aiAvailable` (the server has an AI reader, so "Deeper AI search" can be offered before the first search) | FD-79 |
| `GET /library` | Every ready deck and slide (uploaded decks, then sample decks) | FD-31 |
| `GET /search` | Keyword search and listing: `q`, `kind=slide`, `cursor`, `limit`, `tag`; slides carry packs and tags | |
| `GET /smart-search` | Plain-language search: `q`, `limit`, `read=1` (AI reads it), `ai=off` (skip the AI reader for this search; response says `aiAvailable`, and `aiSkipped: "short"` when the AI was asked for but the search was too short for a model call), `ai=always` (read this submitted search with the AI even if it is short); when the AI read the request, `chips` can include `kind: "Label"` (a slide type, theme or sector it picked from the team's labels, FD-83), `role`, `hidden=include`; returns how it was read (chips), results and why each fits | FD-16, FD-17, FD-56 to FD-59, FD-70, FD-79 |
| `POST /smart-search/feedback` | Useful / Not relevant on a result: `{ query, slideId, verdict, by?, undo? }`; kept only for people who opted in (FD-37; on for everyone is FD-84, waiting on Alina), with the search's words and role and no name; `undo: true` takes one matching earlier click back (changed mind) | FD-59, FD-77, FD-81 |
| `GET /sections?kind=` | Every deck's section of one standard kind (`firm`, `case-studies`, `approach`, `team`, `fees`, `understanding`, `appendix`): `[{ dividerId, name, kind, slideCount, cover }]`, to browse sections without a search; read-only | FD-80 |
| `GET /sections/:dividerId` | One deck section in full, in deck order: `{ name, kind, slides }`; `dividerId` is `slide.section.dividerId` on a result; `hidden=include`; read-only | FD-57, FD-80 |
| `GET /meaning-search` | Slides close in meaning (pgvector) | FD-55 |
| `GET /slides/:id`, `PATCH /slides/:id` | Slide details; rename a slide `{ title }` (`null` restores the original) | FD-73 |
| `GET /slides/:id/preview` | The slide picture, served through the API | |
| `GET /slides/:id/tag-suggestions` | Up to 5 tags worth adding, from the slides closest in meaning: `{ suggestions: [{ tag, from: 'people' \| 'reading', score }] }`; empty when meaning search isn't set up | FD-82 |
| `GET /uploads/preview/:token/tag-suggestions` | Tag suggestions for a file in the upload form, before saving: `{ deck: [...], slides: { "3": [...] } }`; nothing stored; 404 once the preview expires | FD-82 |
| `PATCH /decks/:id` | Archive or restore a deck `{ archived }` | FD-50, FD-52 |
| `POST /exports` | An editable .pptx from an ordered selection (a .zip of one .pptx per deck, or one combined deck) | FD-03, FD-09, FD-21 |
| `POST /storyboard` | A client situation in, a story of slides out; opens or retells a named deck | FD-22 to FD-32, FD-75 |
| `POST /storyboard/refine` | Continue a story from a message | FD-43 |
| `POST /storyboard/feedback` | Useful / Not useful for a slide in a part of a story; opt-in only | FD-24, FD-37 |
| `GET /tags`, `POST /tags` | Tags in use with counts; add a tag to a slide or deck | FD-53, FD-58 |
| `DELETE /tags/:id`, `POST /tags/:id/restore`, `GET /tags/removed` | Remove (kept, with who and when), restore, and the removal log | FD-72 |
| `POST /packs`, `PATCH /packs/:id`, `DELETE /packs/:id` | Slides that only work together: make, rename or confirm, ungroup | FD-38, FD-52 |
| `POST /uploads/preview`, `GET /uploads/preview/:token/:slide` | See an upload's slides before saving it | FD-54 |
| `POST /uploads/suggest` | Suggested deck details from the file (AI optional); `tags=true` with `read=true` also has the AI read the slides for tags: `{ tags: { deck: [{ tag, from: 'ai', score }], slides: { '3': [...] } } }`, up to 5 for the deck and 2 per slide, left out when it can't | FD-23, FD-85 |
| `POST /uploads` | Save an uploaded deck with its details and tags | FD-52, FD-54 |
| `GET /me/settings`, `PATCH /me/settings` | The signed-in person's settings, including their role | FD-71 |
| `GET/POST/PATCH /me/activity` | Opt-in activity (90 days) for Top 10 and Suggested rows | FD-18 |
| `GET /me/saved`, `PATCH /me/saved` | Saved slides | FD-18 |
| `GET/POST /me/drafts`, `DELETE /me/drafts/:id` | Saved decks under My decks | FD-18 |
| `GET /me/suggested` | Suggested for you by role (no screen yet) | FD-71 |
| `GET /speech`, `POST /speech` | Whether talking instead of typing is set up; turn speech into text | |

**Where the build differs from the design below (known, for the next phase):**

- **Identity and authorization:** as decided in FD-01, the prototype's sign-in is a placeholder (the person's name comes in the `X-SlideVault-User` header); M Moser's login replaces it.
- **Collections** are built as personal saved decks (`/me/drafts`), not shared `/collections`.
- **Exports** are built and returned in the same request, not queued as a job (FD-03); there is no `/jobs` API.
- **Uploads** are a single multipart request, not reserve-then-complete; there are no review, version or source-delete endpoints yet.
- **Concurrency:** no `If-Match` revisions on changes yet.
- **Schema:** one `server/sql/schema.sql` applied by `npm run db:setup`, not versioned migrations with rollback notes.

## HTTP conventions

Default base: `/api/slide-vault/v1`, configurable through the transport adapter. All endpoints authenticate and authorize independently. JSON uses camelCase and ISO 8601 UTC timestamps. Validate input with runtime schemas and return allowlisted DTOs, never raw ORM records or storage keys.

Success: `{ "data": ..., "requestId": "..." }`. Lists add `page: { nextCursor }` and scoped facets if requested. Error: `{ "error": { "code": "FORBIDDEN", "message": "...", "retryable": false }, "requestId": "..." }`. Do not return stack traces or source contents in errors.

Use 400 for invalid input, 401 for missing/invalid identity, 403 for disallowed actions, 404 for missing or inaccessible objects, 409 for version/idempotency conflicts, 413 for size limits, 415 for unsupported file types, 422 for unsupported content, and 429 for rate limits. Choose object 404 responses consistently to avoid revealing existence. Supply `Retry-After` where appropriate.

Private authenticated responses use `Cache-Control: private, no-store` by default. A future cache must include identity/access scope and content versions, and support revocation. Mutations accept `If-Match` with the current row revision; responses return the new revision/ETag. Create/upload/export/retry requests accept an `Idempotency-Key` scoped to principal, library, operation and payload hash; key reuse with different input returns 409.

| Endpoint | Purpose | Required authorization |
| --- | --- | --- |
| `GET /session` | Safe effective capabilities and authorized libraries | Active verified identity |
| `GET /search` | Query, filters, kind=deck/slide, cursor, limit | Read on every result and facet |
| `GET /sources/:id` | Source/version metadata and paged slide references | Source read |
| `GET /sources/:id/versions/:versionId/download` | Retrieve the immutable original or an authorized temporary grant | Explicit source download/reuse permission; preview access alone is insufficient |
| `GET /slides/:id` | Slide details, provenance, restrictions and warnings | Slide/source read |
| `GET /slides/:id/preview` | Authorized media response or short-lived read grant | Current slide/source read |
| `POST /uploads` | Reserve private upload; return `uploadId`, scoped grant, expiry | Upload in target library |
| `POST /uploads/:id/complete` | Verify actual object type/hash/size and enqueue ingest | Same authorized upload owner |
| `PATCH /sources/:id` / `PATCH /slides/:id` | Allowlisted metadata change, with revision | Metadata edit and resource access |
| `POST /sources/:id/reviews` / `POST /slides/:id/reviews` | Submit/approve/return/retire an exact version with reason | Relevant transition permission |
| `POST /sources/:id/versions` | Attach a completed upload as a new immutable version | Source update + upload rights |
| `DELETE /sources/:id` | Begin documented deletion workflow | Explicit source delete rights |
| `POST /collections` | Create private ordered collection | Collection write in library |
| `GET /collections/:id` / `PATCH /collections/:id` | Load/edit ordered items and title with revision | Collection ownership/access plus per-item checks |
| `POST /exports` | Snapshot validated order and enqueue PPTX export | Export on every source and collection access |
| `GET /exports/:id` | Export state, safe warnings and manifest summary | Requester or explicitly authorized operator |
| `GET /exports/:id/download` | Recheck access then deliver/grant temporary artifact | Current export and every source permission |
| `GET /jobs/:id` | Safe status, progress, attempts and error | Job owner or authorized operator |
| `POST /jobs/:id/retry` / `POST /jobs/:id/cancel` | Explicit retry/cancellation | Owner/operator and current source permissions |

Grant responses for upload/media are the narrow exception to ordinary DTOs: return only the URL/token, method, allowed headers and expiry required for that operation. Never persist or log signed grants. Prefer authenticated media streaming when immediate revocation is required.

Example export request (synthetic IDs):

```json
{
  "collectionId": "collection_example",
  "collectionRevision": 4,
  "format": "pptx",
  "fidelityPolicy": "preserve-source",
  "items": [
    { "slideId": "slide_example_a", "sourceVersionId": "version_example_1" },
    { "slideId": "slide_example_b", "sourceVersionId": "version_example_2" }
  ]
}
```

Return 202 with the export/job IDs and a status URL. Validate that the requested items and order match the specified collection revision. Queueing is not completion. Poll with backoff and cancellation support; a future event stream must preserve the same authorization semantics.

An initial upload request includes the target library, title, filename, expected MIME/bytes and optional hash. Completing it creates the source/version and job transactionally; replacing a source uses the explicit versions endpoint instead. Client-declared metadata is untrusted and actual object validation controls acceptance.

## Editable export contract

Preserve original source files and copy approved selected slide content into a new PPTX. Text, shapes, images and supported native charts/tables must retain the editability demonstrated in the Gate 0 corpus. Preserve relevant layouts, masters, relationships, resources and theme references. A preview image placed on a PPTX slide does not meet this requirement.

At Gate 0 publish a support matrix for text, fonts, shapes, images, tables, charts, diagrams/SmartArt, animations, video, linked media, notes, hidden slides and mixed aspect ratios. Decide preservation versus exclusion explicitly. Default release scope is `.pptx`; do not promise `.ppt`, `.pptm`, password-protected files or PDF-to-editable reconstruction. Optional PDF reference content must be labeled as such and cannot satisfy editable-export acceptance.

Use preserve-source formatting by default. Automatic re-theming/layout cleanup is a separate fidelity policy and later decision. Never silently stretch a 4:3 slide into 16:9 or flatten unsupported content. Report affected slides and let the user remove them or choose an explicitly labeled allowed fallback; Gate 0 determines which fallback modes may ship.

The export manifest records ordered slide/version references, source hashes, warnings, engine version, job ID and creation time. Keep sensitive provenance inside protected metadata; do not add internal source links or notes to client-facing output without an explicit policy. Recheck access/review state when requesting, starting the job and initiating authenticated download or issuing a temporary grant. Revocation blocks new app download requests and triggers dependent-artifact invalidation. An already-issued storage grant may remain usable until expiry; D-08 must select and test the bounded-grant or immediate-revocation policy before Gate 3 acceptance.

## Durable jobs

Delivery is at least once; every processing stage must be idempotent. Use a persisted queue/outbox transaction or a reconcilable equivalent so a committed request cannot be lost before enqueue. Workers acquire a bounded lease and heartbeat; an expired lease allows safe recovery. Never assume a single worker or a single callback.

Write temporary outputs privately and publish only after checksum and database commit. Retry transient failures with bounded backoff; preserve permanent failures for an operator. Record attempt limits and job time/size budgets at Gate 0. Cancellation prevents new stages and publication, then cleans temporary outputs. A source change or permission revocation can invalidate an in-flight job.

Reprocessing carries a pipeline version and produces separate derived assets until successful. Test crash/restart between each state transition, duplicate delivery, poison files, stale permissions, provider outage and cleanup of abandoned uploads. Track status stages rather than fabricated percentage estimates.
