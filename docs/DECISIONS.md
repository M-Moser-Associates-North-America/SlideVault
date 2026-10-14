# Decisions and kickoff agenda

**Prepared:** 29 September 2026. **State:** initial handoff draft. This log distinguishes owner instructions from recommendations; no recommendation below is an owner approval.

## Confirmed constraints

| ID | Constraint | Basis |
| --- | --- | --- |
| C-01 | Develop SlideVault as a standalone tool in this repository | Owner instruction |
| C-02 | Keep the implementation modular to allow potential future integration into an internal system | Owner instruction |
| C-03 | Use the supplied HTML and team presentation to inform the product | Owner instruction; reference files in `reference/` |

The source deck states editable PPTX output, source preservation, trust metadata, access restrictions and human editorial control. These are source requirements captured in the [product brief](PRODUCT_BRIEF.md). Exact release scope still needs agreement.

## Proposed architecture decisions

| ADR | Recommended decision and rationale | Alternatives / consequence | Status |
| --- | --- | --- | --- |
| ADR-001 | Reusable React workspace inside a standalone Next.js application, with replaceable runtime adapters | Coupling feature logic to application navigation, login or deployment configuration makes later reuse more expensive. | Proposed |
| ADR-002 | Modular web app with an independently runnable worker for parsing/render/export | Inline processing ties reliability to request lifetimes. Many unrelated services add operational cost before scale is known. | Proposed |
| ADR-003 | Private PostgreSQL metadata and private object storage; immutable versioned originals | Store large binaries outside relational rows. Explicit adapters allow infrastructure changes without changing domain/UI contracts. | Proposed |
| ADR-004 | Preserve source formatting and native supported objects for editable export | Re-theming or image-only assembly is easier to demonstrate visually but changes the promised output. Fidelity spike must select the actual engine. | Proposed |
| ADR-005 | Server-enforced action and resource access on every surface and worker delivery | Client capability checks improve UX only. Define and test SlideVault's authorization policy independently. | Proposed |
| ADR-006 | Text/metadata search first; optional semantic/AI enrichment behind adapters | Avoid provider dependency before a relevance corpus exists. A mandatory AI-first release changes scope, costs and content-processing approvals. | Proposed |
| ADR-007 | Namespaced SlideVault design tokens plus accessible interaction requirements | The approximate HTML has simulated controls; the written design contract specifies implementation requirements. | Proposed |
| ADR-008 | Library first, manual storyboards next, broader RFP/connector work later | Full workflow delivery is possible with revised milestones and estimates. No feature in the supplied references is silently treated as already delivered. | Proposed |

## Open decisions

Resolve a decision before its dependent work, not necessarily before all work starts. Use mock adapters and synthetic data for independent progress.

| ID | Decision / working recommendation | Decision owner | Resolve by |
| --- | --- | --- | --- |
| D-01 | First release: library/search/compare/curation/ordered PPTX export; confirm whether storyboards, RFP assistance or SharePoint must move earlier | Product owner | Gate 0 scope/estimate |
| D-02 | Visibility: choose library boundaries and membership rules; start with private assigned-library access and explicit export rights | Product owner + technical reviewer | Before schema/access acceptance |
| D-03 | Governance: name curators, approval/review cadence, valid canonical variants and confidentiality/reuse restrictions | Product owner + proposal reviewer | Gate 0 |
| D-04 | File/output policy: PPTX first; exact clients, native objects, notes/hidden slides, font substitutions, aspect ratios and any PDF reference support | Proposal reviewer + technical lead | Fidelity spike before ingest/export commitment |
| D-05 | Converter/parser/render stack: demonstrate candidates, costs, licensing, native binary/font needs and deployment portability | Technical lead + technical reviewer | Gate 0 |
| D-06 | Resource targets: corpus size, file limits, concurrency, latency, reliability, quota and cost budgets | Product owner + technical lead | Gate 0 estimate |
| D-07 | Infrastructure: development database/storage/auth/worker, deployment region, resource ownership and standalone production topology | Technical lead + technical reviewer | Gate 0 topology; production configuration before pilot |
| D-08 | Data handling: approved fixtures, retention/purge/backups, short-lived grants versus immediate revocation, permitted external processors | Product owner + technical reviewer | Revocation semantics before Gate 3 acceptance; all real-data/processor choices before their pilot/use |
| D-09 | Portability evidence: reusable module boundaries, configurable routes, adapter replacement and independent deployment/data transfer | Technical reviewer | Gate 4 portability demonstration |
| D-10 | Phase 2: required project linkage, people directory behavior, shared editing/roles, page budgets and storyboard output/share semantics | Product owner + proposal reviewer | Before Phase 2 estimate |
| D-11 | SharePoint: selected locations, connector identity, effective user ACLs, refresh/deletion guarantees and support owner | Technical reviewer + content owner | Before connector implementation |
| D-12 | AI: use cases, provider/region/retention, evaluation corpus and metrics, cost limits, evidence and review UX | Product owner + technical lead | Before model/embedding processing |
| D-13 | Handoff/support: delivery repository rights, dependency licenses, operational owner, defect support window and who controls all deployment accounts | Product owner + team lead | Before delivery agreement and Gate 4 |

## Kickoff sequence

1. Confirm D-01 and demonstrate the primary journey: find, trust, compare, select, export.
2. Agree a small permitted PPTX corpus and a reviewer who can assess the exported file in PowerPoint.
3. Resolve library membership, approval and reuse policy before implementing access control.
4. Review the standalone architecture and portability contract with the technical reviewer.
5. Have the team return a fidelity spike, infrastructure proposal, milestone estimates and risk/assumption list.

## Record an outcome

For each resolved decision append a record with the following fields and update the affected documents together:

```text
Decision ID and title:
Status: proposed | accepted | superseded
Decision date:
Decision owner/reviewer:
Context and evidence:
Options considered:
Chosen outcome:
Consequences for scope, cost, security and integration:
Acceptance evidence / affected PR criteria:
Documents/contracts changed:
Revisit trigger:
```

Do not fill the owner/reviewer/date fields with invented approvals. Supersede past records rather than erase the reason a choice was made.

## Prototype decision records (The Foundry)

Shortcuts taken in the prototype build, recorded so none of them is mistaken for the target design. All are **proposed**: none has been reviewed or approved by the product owner. Owner, reviewer and decision-date fields stay empty until a real decision is made. Proposed on 7 October 2026 by The Foundry.

```text
Decision ID and title: FD-01 No sign-in in the prototype
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: product owner + technical reviewer)
Context and evidence: The prototype runs locally on synthetic fixtures. Identity provider and access model are open (D-02, D-07).
Options considered: (a) no sign-in, local only; (b) a temporary shared password; (c) the selected identity provider behind the auth adapter.
Chosen outcome: (a). The shell supplies a fixed session scope ("local-dev") and the capabilities library.read, collection.write, export.create. GET /session reports the same set.
Consequences for scope, cost, security and integration: Must not be hosted with real content. PR-09 (server-side denial) is not met. Capability checks in the UI are display hints only.
Acceptance evidence / affected PR criteria: PR-09 open.
Documents/contracts changed: none (runtime contract unchanged).
Revisit trigger: Before any hosted preview, and at Gate 1 identity/access adapters.
```

```text
Decision ID and title: FD-02 File-backed library index instead of PostgreSQL
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: technical lead + technical reviewer)
Context and evidence: No database is provisioned yet (D-07). The prototype needs stable IDs and immutable versions to match the domain model.
Options considered: (a) JSON index written by `npm run ingest`; (b) local PostgreSQL now.
Chosen outcome: (a). `.data/library.json` (gitignored) holds sources, immutable versions (ID from the SHA-256 of the original bytes) and slides with opaque IDs, mirroring the Source deck / Source version / Slide entities in DATA_AND_API.md.
Consequences for scope, cost, security and integration: No concurrent writes, no review state, no memberships. Index reloads require an app restart.
Acceptance evidence / affected PR criteria: PR-01 (durable ingestion) and PR-05 open.
Documents/contracts changed: none.
Revisit trigger: Real upload (build step 5) / Gate 1 schema and migrations.
```

```text
Decision ID and title: FD-03 Synchronous export instead of 202 + job
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: technical lead)
Context and evidence: DATA_AND_API.md specifies POST /exports → 202 with a durable job. Fixture exports finish in well under a second.
Options considered: (a) build the file in the request and return it; (b) job queue + worker now.
Chosen outcome: (a). POST /api/slide-vault/v1/exports returns the .pptx directly with the standard error envelope on failure.
Consequences for scope, cost, security and integration: No progress, retry, cancellation or export manifest. Large or slow exports would block a request.
Acceptance evidence / affected PR criteria: PR-08 open. Covered by `npm run test:export`.
Documents/contracts changed: none.
Revisit trigger: Before Gate 3, or when exports exceed a few seconds.
```

```text
Decision ID and title: FD-04 Runtime contract addition: assetUrl(path)
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: technical reviewer)
Context and evidence: Slide previews are <img> elements, which cannot be loaded through runtime.request(). INTEGRATION_CONTRACT.md publishes a sketch to be finalized as compilable types.
Options considered: (a) add assetUrl(path) so the host resolves media URLs; (b) fetch every preview through request() into object URLs.
Chosen outcome: (a). `features/slide-vault/contracts/runtime.ts` adds assetUrl(path: string): string. The standalone shell maps it to the API root and rejects absolute or traversing paths.
Consequences for scope, cost, security and integration: A host must implement one more function. Previews stay behind the API (no public files), so access can be enforced there once sign-in exists.
Acceptance evidence / affected PR criteria: PR-03 previews.
Documents/contracts changed: features/slide-vault/contracts/runtime.ts (compilable contract v0.1); pointer added in docs/INTEGRATION_CONTRACT.md.
Revisit trigger: Gate 1 contract publication.
```

```text
Decision ID and title: FD-05 One source deck per export; each slide once
Status: superseded in part by FD-09 (multi-deck selections); the each-slide-once rule still applies
Decision date: (pending)
Decision owner/reviewer: (pending: technical lead + proposal reviewer)
Context and evidence: The export engine copies the source package and removes unselected parts, which preserves masters, layouts and fidelity for one deck. Gate 0 requires slides from multiple decks.
Options considered: (a) single-deck exports now, multi-deck next; (b) delay all exports until multi-deck assembly exists.
Chosen outcome: (a). Mixed-deck requests return 422 UNSUPPORTED_SELECTION with a clear message; duplicates return 400.
Consequences for scope, cost, security and integration: Gate 0 is not yet met. Repeated use of a slide (allowed by the data contract) is not yet supported.
Acceptance evidence / affected PR criteria: PR-07 (single deck) passing in `npm run test:export`; multi-deck open.
Documents/contracts changed: none.
Revisit trigger: Next build milestone (multi-deck export).
```

```text
Decision ID and title: FD-09 Multi-deck selections download as a zip of one .pptx per deck
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: technical lead + proposal reviewer)
Context and evidence: PRD v2.1, Journey 5 (P0): "Slides from the same deck come as one editable .pptx. Slides from different decks come as separate editable files in one zip." Merging decks into one .pptx is P1 in the same PRD. FD-05 rejected mixed-deck selections with 422.
Options considered: (a) zip of one .pptx per deck, each built by the existing single-deck engine; (b) merge all decks into one .pptx now; (c) keep rejecting mixed selections.
Chosen outcome: (a). One deck still returns SlideVault-export.pptx. Several decks return SlideVault-export.zip; files are numbered in the order their decks first appear in the selection and named "<n> - <deck title> (slides a, b).pptx". Each file keeps the selected order of its own slides. Each slide is still allowed once per export (FD-05).
Consequences for scope, cost, security and integration: No change to the export engine or its fidelity rules (FD-07 applies to every file). The overall cross-deck order is visible only through the file numbering. Gate 0's single-file multi-deck assembly stays open (PRD P1 merge).
Acceptance evidence / affected PR criteria: PR-07 for each file; `npm run test:export` (zip contents, per-deck order, no broken references) and an API check returning application/zip.
Documents/contracts changed: features/slide-vault/server/services/export.ts, server/export-bundle.ts (new), client/api.ts (exportPptx returns the file name), components/SelectionPanel.tsx, app/api/slide-vault/v1/exports/route.ts, scripts/test-export.mts, docs/foundry/RUNNING.md.
Revisit trigger: When the P1 merge into one .pptx is built.
```

```text
Decision ID and title: FD-11 The same file in two folders becomes one deck with both folders' details
Status: proposed
Decision date: 2026-10-13
Decision owner/reviewer: Vincent (build), Schiffon (upload owner, agreed 2026-10-13)
Context and evidence: Best of the Best decks are copies of past submittals, so one file sits in Submittals/<year>/<client>/ and in Best of the Best/<category>/. Upload rejected the second copy as DUPLICATE_DECK, so the deck lost either its year or its Best of the Best flag depending on upload order. Found with npm run upload:library on the synthetic library (6 decks stored with no year). Smart search filters on these fields.
Options considered: (a) keep one deck and fill in what the second folder adds; (b) store both copies as separate decks; (c) keep skipping and rely on upload order.
Chosen outcome: (a). A file with a known hash adds details to the existing deck: Best of the Best can be turned on, never off; year, client and category are filled in only when missing, never overwritten. The response is 200 with alreadyUploaded and addedDetails. A copy that adds nothing is still 409 DUPLICATE_DECK. Nothing is stored twice.
Consequences for scope, cost, security and integration: Search shows one deck instead of two identical ones. If two folders disagree (different years), the first one wins silently; flagging conflicts for a curator is a follow-up once real folder names are known.
Acceptance evidence / affected PR criteria: npm run test:deck-details; rerunning npm run upload:library fills in the missing years.
Documents/contracts changed: server/deck-details.ts (new), server/services/upload.ts, server/pg-repository.ts (findDeckByHash returns deck details; updateDeckDetails), contracts/dto.ts (DeckSummary.alreadyUploaded, addedDetails), scripts/upload-library.mts.
Revisit trigger: Real SharePoint folder names from M Moser.
```

```text
Decision ID and title: FD-06 Selection stored in the browser
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: product owner)
Context and evidence: PR-06 requires saved, reloadable selections on the server. No database yet (FD-02).
Options considered: (a) localStorage, keyed by sessionScopeKey; (b) in-memory only.
Chosen outcome: (a). Survives reload in one browser; cleared per session scope; never shared.
Consequences for scope, cost, security and integration: Not authoritative; not shareable; lost with browser data.
Acceptance evidence / affected PR criteria: PR-06 open.
Documents/contracts changed: none.
Revisit trigger: When collections are persisted (with FD-02).
```

```text
Decision ID and title: FD-07 Export defaults: what leaves the source
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: proposal reviewer, see D-04)
Context and evidence: Exports are client-facing. DATA_AND_API.md: keep internal provenance out of client-facing output without an explicit policy.
Options considered: Keep or remove speaker notes, review comments, document properties, cover thumbnail; keep or show hidden slides.
Chosen outcome: Remove unselected slides and their media, speaker notes, comments and comment authors, the source cover thumbnail, and source author/title/slide-title properties. A hidden source slide becomes visible when deliberately selected.
Consequences for scope, cost, security and integration: Notes cannot be exported until the owner asks for them (questionnaire item 12).
Acceptance evidence / affected PR criteria: PR-07; `npm run test:export`.
Documents/contracts changed: none.
Revisit trigger: D-04 support-matrix decision.
```

```text
Decision ID and title: FD-08 Preview rendering with LibreOffice and poppler
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: technical lead + technical reviewer, see D-05)
Context and evidence: Previews must show real slides. No renderer is selected (D-05).
Options considered: LibreOffice headless + pdftoppm; a commercial renderer; Keynote/PowerPoint automation (not portable).
Chosen outcome: LibreOffice (MPL-2.0) + poppler (GPL, used as a separate command-line tool). For previews only, brand fonts the renderer cannot use are mapped to Arial / Arial Narrow.
Consequences for scope, cost, security and integration: Previews can differ slightly from PowerPoint (fonts, line breaks). Both tools must be installed wherever ingestion runs and belong in the dependency/license inventory.
Acceptance evidence / affected PR criteria: PR-01 / PR-03 previews.
Documents/contracts changed: none.
Revisit trigger: Gate 0 renderer comparison.
```

```text
Decision ID and title: FD-13 Home, browse and deck screens built from the approved v3 design, with small additive contract changes
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: UX lead + technical lead)
Context and evidence: The team approved the v3 prototype (mockup/SlideVault-v3.html, mockup/CHANGES.md). The workspace had one real screen (a flat slide list). The v3 screens need to group slides by client, year, category and deck, and to list every slide of a deck.
Options considered: (a) add optional deck fields to the slide provenance and an opt-out of duplicate collapsing on search; (b) add new /decks endpoints now; (c) keep the contract and show no grouping.
Chosen outcome: (a). Provenance gains optional clientName, deckYear, category, bestOfTheBest (null when the folder path does not say). GET /search accepts duplicates=all to return every copy (badges still set) so a deck page is complete. The runtime contract's View gains 'browse' and 'create', and the runtime gains an optional hrefFor(location) so links can open in a new tab. Search text stays out of the URL. The workspace loads the whole library once and groups it in the browser until a deck endpoint exists.
Consequences for scope, cost, security and integration: All changes are additive and optional. Loading everything in one go is fine at prototype size (a few thousand slides) but needs a paged deck endpoint for the full archive. Not carried over from the prototype because the backend cannot support them yet: Suggested/Approved/Retired tiers and the Access switch, content classes, AI-written "why it fits" lines, AI label tags, "Most downloaded". Upload from the browser, Create and the Review screen are placeholders. Example searches under the box are plain single words the keyword search can answer.
Acceptance evidence / affected PR criteria: tests/e2e/accessibility.spec.ts rewritten for these screens (12 checks, light and dark, keyboard, 320 px reflow). npm run typecheck, lint, test:export and test:duplicates pass. PR-03 provenance fields unchanged.
Documents/contracts changed: contracts/dto.ts (Provenance), contracts/runtime.ts (View, hrefFor), GET /search (duplicates=all), docs/DECISIONS.md. After merging the schiffon branch: /slide-vault now renders these v3 components, Schiffon's real upload (POST /uploads) is restyled into the v3 Upload screen, and her shell menu is replaced by the workspace tab bar. The /v3 page (features/slide-vault/v3) is untouched.
Revisit trigger: When the Postgres read path replaces the file index, when a /decks endpoint exists, and when review tiers and AI labels are built.
```
