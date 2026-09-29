# Data and API contract

**Status:** recommended v0.1 design. No schema or endpoints exist yet. Gate 1 must publish an OpenAPI schema and shared TypeScript DTOs matching the implementation. Scope follows [Product brief](PRODUCT_BRIEF.md); provider choices remain in [Decisions](DECISIONS.md).

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
