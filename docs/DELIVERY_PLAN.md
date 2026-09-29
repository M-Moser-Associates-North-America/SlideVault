# Delivery and acceptance plan

**Status:** recommended sequence for estimating and delivery. No dates, fees, staffing levels or release scope have been approved. The external team supplies estimates after Gate 0. Phase 1 is the proposed library release; Phases 2 and 3 require separate scope agreement.

## Owners and working method

| Role | Responsibility |
| --- | --- |
| Product owner | Release priorities, test corpus permission, user acceptance and unresolved business policy |
| External technical lead | Implementation, estimates, technical decisions, dependency/license evidence and deployment/runbook delivery |
| Proposal-team reviewer / curator | Search relevance, trust metadata, export usability and editorial workflow |
| Technical reviewer | Architecture, portability, deployment and handoff acceptance |

One person may hold more than one role. Record names at kickoff. Agree a demo/review cadence and turnaround times; do not assume availability or an implicit acceptance window.

Work in reviewable pull requests with acceptance IDs and real verification evidence. Provide preview access only to the isolated environment. Keep `main` releasable after the scaffold exists, with CI required before merge. Propose scope changes with their cost, schedule and integration impact, and update the decision log. Routine implementation choices within the baseline do not need repeated approval.

## Phase 1 gates

| Gate | Work and deliverables | Exit evidence | Review owners |
| --- | --- | --- | --- |
| **0: Scope and risk proof** | Confirm release boundary and access rules; build synthetic corpus; compare viable PPTX parser/renderer/assembler choices; define support matrix, limits, environment topology and estimates | Selected slides from multiple source decks exported in order; native text and required objects edited in agreed PowerPoint clients; visual comparison; source hashes unchanged; recorded costs/licenses/limitations; decisions D-01 through D-08 addressed as applicable | Product, proposal reviewer, technical lead, technical reviewer |
| **1: Portable foundation** | Standalone Next.js application, public feature/server boundaries, schema/migrations, private storage, identity/access adapters, placeholder configuration, fixtures and CI | Clean checkout setup; workspace mounted in the app and a generic test container; theme and base path swapped; denied-resource tests; initial OpenAPI/DTO contract; development resources separate from production | Technical lead, technical reviewer |
| **2: Trusted library** | Real private upload/processing, durable jobs, source/version/slide provenance, review/retire workflow, search/filters and comparison | PR-01 to PR-05 and relevant PR-09 cases demonstrated with persistent data; unsupported-file failures and crash/retry recovery; authorized draft versus approved views | Proposal reviewer, technical lead |
| **3: Ordered editable output** | Persisted collection, ordering, current-access checks, worker export, manifest and restricted download | PR-06 to PR-08 and full PR-09 pass; fidelity corpus review; source version changes and revocation exercised during queueing and delivery | Product, proposal reviewer, technical lead |
| **4: Acceptance and handoff** | Accessibility/UX review, performance characterization, operations runbooks, clean install/restore, portability demonstration and complete release bundle | PR-01 to PR-10 evidence; portability contract checks in a generic test container; unresolved defects classified; approved limitations documented; repeatable source/data transfer and staging rollback | Product and technical reviewer, supported by technical lead |

A gate is complete when its evidence and limitations are reviewed, not when screens resemble the mockup. Maintain a simple acceptance record with criterion, release/commit, fixture, result, reviewer and date. Do not mark proposed criteria as accepted in advance.

## First implementation backlog

Create issues in this order, keeping risk work early. These are work packages, not estimates.

| Work package | Dependency | Expected result |
| --- | --- | --- |
| SV-001 Scope and corpus | None | Gate 0 decision answers, sanitized evaluation cases and fidelity rubric |
| SV-002 Export feasibility | SV-001 fixture permission | Compared converter options, working native-object export sample and support matrix |
| SV-003 Portable scaffold | Scope direction | Standalone shell, browser/server entry points, design primitives, documented startup and CI |
| SV-004 Authorization and persistence | Access-model decision | Versioned schema, memberships/adapter, private storage, API contract and denial tests |
| SV-005 Ingest worker | SV-002, SV-004 | Validated upload, render/text extraction, idempotent processing and honest status |
| SV-006 Trust and discovery | SV-005 | Search/filter/detail/compare plus review and canonical-version workflow |
| SV-007 Collections and exports | SV-002, SV-004, SV-006 | Saved ordered version references, async export and authorized download |
| SV-008 Hardening and portability | Prior work packages | Performance/UX/accessibility evidence, failure recovery, generic test-container demo and handoff bundle |

Visual foundation work can run alongside the fidelity spike. Do not commit to a broad file-format promise or large ingestion build before the spike proves the required export behavior.

## Evaluation corpus and limits

Use synthetic decks covering plain text/shapes, photographs, different fonts, masters/layouts, tables, charts, mixed slide sizes and explicitly unsupported features. Include malformed/oversized/duplicate files and confidential variants with different permissions. Use at least two users and two library scopes plus a curator identity. Keep approved synthetic fixtures in `tests/fixtures/` with provenance/license notes; confidential evaluation files stay outside git.

Gate 0 records numerical targets in the following table before the team estimates a production-ready delivery. Proposed targets require product/infrastructure agreement; the supplied material contains no credible baseline volumes or latency promises.

| Parameter | Required decision/evidence |
| --- | --- |
| Supported clients | Exact PowerPoint desktop/web clients and versions used for editability/fidelity acceptance |
| Corpus and growth | Deck/slide count, average/max file size, expected monthly additions and retention |
| File safety limits | Upload bytes, slides per deck, expanded archive size/entries, per-job CPU/memory/time |
| Concurrent load | Active search users, parallel uploads/exports and worker concurrency |
| Search performance | P95 response target on defined corpus/hardware; relevant-results rubric for a fixed query set |
| Processing performance | P95 ingest/export time for named fixture sizes; timeout, retry and failure budgets |
| Export quality | Supported objects, visible-difference rubric, allowable font substitutions, aspect-ratio policy and review owner |
| Recovery | Backup interval, tested recovery time/data-loss target and operational owner |
| Cost | Storage, worker, conversion license, search and optional AI monthly budget with alert threshold |

Report measured numbers with dataset size, environment, concurrency and date. Do not present a single developer-machine run as a production capacity claim.

## Verification matrix

| Area | Required cases |
| --- | --- |
| Domain/versioning | Immutable originals; transactional canonical swap; duplicate handling; stale metadata/collection revision; source changed since selection |
| Permissions | Anonymous, inactive, reader/contributor/curator; cross-library and guessed-ID access; search snippets/counts/autocomplete; direct preview/object URLs; other users' jobs/collections/exports |
| Revocation | Access or approval removed before execution and before authenticated download/grant issuance; previously issued grants tested against D-08 expiry or immediate-revocation policy; stale search index; document deleted while processing |
| Workers | Process crash/restart, expired lease, duplicate queue delivery, bounded retries, corrupt file, converter outage, cancellation and orphan cleanup |
| PPTX | Correct order and slide count; source bytes unchanged; text and supported objects editable; fonts/masters/images/charts visually reviewed; clear unsupported behavior |
| UX | Search/filter/compare/add/reorder/export; keyboard reorder; loading/empty/denied/failed/partial-service states; cancel/retry; refresh and back navigation |
| Accessibility | Keyboard, focus return, screen-reader names/status, contrast, reduced motion, zoom, light/dark and agreed responsive widths |
| Portability | Different route/API prefixes, transport/session adapter swap, rendering in a generic test container, no global CSS leakage, application shell separable |
| Operations | Fresh checkout, migrations and seed, web/worker build, secrets isolated, backup restore, reindex and reviewed rollback |

After the scaffold exists, provide and document commands for type checking, linting, unit/integration tests, browser tests and production build. Keep CI checks deterministic with synthetic fixtures. Converter-dependent tests run in the documented worker environment. Manual PowerPoint fidelity review supplements automated structural checks; it cannot be claimed from a ZIP-validity or screenshot-only test.

## Later phases

**Phase 2, manual storyboards:** scope PR-11 to PR-13 with the owner. Implement sections, tiles, notes, page allocation, assignment, ordered attachments and optional project linkage. Agree storyboard save/share/export behavior first; a plan PDF and an assembled slide deck are different artifacts. Preserve source permissions. Decide collaboration semantics and conflict handling before allowing shared editing.

**Phase 3, assisted workflow:** define a separate scope/evaluation for RFP extraction, semantic recommendations, SharePoint synchronization, quality checks and curation suggestions. PR-14 is a human-control principle, not a complete AI/connector acceptance specification. Establish provider permissions, costs and quality thresholds before implementation. SharePoint can move earlier only with explicit scope and ACL evidence.

## Release bundle and definition of done

- Versioned source release with lockfile, selected runtime versions, reproducible build and dependency/license inventory.
- Portable workspace and server modules, complete standalone application shell, replaceable runtime adapters and passing portability demonstration.
- Worker package/container definition, required binary/font inventory, queue configuration and health/recovery procedures.
- Authoritative migrations, synthetic seed, schema/DTO/OpenAPI reference, forward migration and rollback/restore notes.
- Complete placeholder `env.example`, environment validation, startup/deploy instructions and resource ownership list.
- Synthetic fixture corpus, export support matrix, sample output/manifests, verification evidence and known limitations.
- Data transfer/reconciliation instructions, backup/restore evidence, retention/deletion/reindex runbooks and operational metrics.
- Acceptance record for agreed requirements, defect list with owners/severity, and an explicit handoff/support arrangement.

Stop-ship findings include unauthorized content access, source corruption, falsely advertised editability, unrecoverable lost jobs, and failure of the agreed module portability checks. Other defects require an explicit release disposition. Any future integration into an internal system is a separate scope; this delivery is accepted as a standalone application with documented reusable interfaces.
