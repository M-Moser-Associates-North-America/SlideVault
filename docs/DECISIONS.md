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
Decision ID and title: FD-12 Use M Moser's Supabase project through personal logins, with no master key
Status: proposed
Decision date: 2026-10-18
Decision owner/reviewer: Vincent (build), Schiffon (data layer), Alina Pak (project owner)
Context and evidence: On Oct 14 Alina created a SlideVault project in M Moser's Supabase account and gave each developer a personal database login (switching to the shared slidevault_developer role inside our own schema) and a separate Storage account limited to one private bucket and a personal upload folder. No service-role (master) key is issued. The app previously used a master key through the Supabase REST API on a team member's personal project.
Options considered: (a) direct Postgres connection with the personal login, plus Storage through the signed-in Storage account; (b) ask for a service-role key; (c) stay on the personal project.
Chosen outcome: (a). server/db.ts opens a small connection pool with the personal login, switches role and schema on every connection, and passes every value as a query parameter. server/sql/schema.sql creates the tables (npm run db:setup, safe to rerun). server/storage.ts signs in once and stores originals at <prefix>/originals/<deck id>.pptx and thumbnails at <prefix>/previews/<deck id>/0001.png. The bucket allows upload and read but not overwrite or delete, so keys are always new and nothing deletes. Until the bucket accepts PNG, thumbnails are kept on the developer's computer (data dir, keys starting "local:"). Settings are SV_* in .env.local (env.example).
Consequences for scope, cost, security and integration: No master key exists in the app or on any laptop; the database enforces what each login can do. Meaning-based search waits for M Moser to enable pgvector. Deleting decks (archive/delete) needs delete permission or an admin path from M Moser. Each developer's thumbnails stay local until images are allowed. The old supabase/migrations folder describes the personal project and is kept for history.
Acceptance evidence / affected PR criteria: scripts/check-mmoser-access.mts (access check); every repository function tested against a local Postgres with the same role and schema setup; npm run db:setup run twice with no changes the second time.
Documents/contracts changed: server/db.ts (new), server/sql/schema.sql (new), server/pg-repository.ts, server/storage.ts, server/config.ts, server/services/export.ts, scripts/db-setup.mts (new), scripts/check-mmoser-access.mts (new), scripts/change-mmoser-passwords.mts (new), env.example, package.json (pg).
Revisit trigger: pgvector enabled; bucket accepts images; M Moser's integration plan for auth and storage.
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

```text
Decision ID and title: FD-14 Simulated approval tiers, AI labels and smart search in the real front end (front end only)
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: UX lead + technical lead)
Context and evidence: FD-13 left the v3 approval tiers, Access switch, AI "why it fits" lines, AI labels, most-downloaded rows and the upload label queue out of /slide-vault because the backend has no data for them. The client demo needs to show the intended experience.
Options considered: (a) show them in the real screens, simulated in the browser and marked clearly; (b) leave them in /v3 only; (c) add backend fields now.
Chosen outcome: (a). components/simulation.ts derives status (Approved, Suggested, Retired), sample download counts, suggested labels and a "smart search" reading (topics, client, year, "why it fits") from each slide's id, title, deck name and folder details. Real server keyword hits still count in the ranking. Everything simulated carries the orange "Simulated" mark. The shell's Access switch (Viewer, Editor, Curator) stands in for sign-in and changes the capabilities passed to the workspace: Editor adds metadata.edit (sees Suggested, can upload), Curator adds content.review and content.retire (also sees Retired). No contract type changes.
Consequences for scope, cost, security and integration: No data is saved, sent or read from a model. Statuses are not real approvals and must never be presented as such. Visibility by tier is a display filter only; authoritative authorization stays on the server (AGENTS.md). Replace simulation.ts with real review state, labels and AI search when D-03 and D-12 are decided.
Acceptance evidence / affected PR criteria: axe checks clean in light and dark on Home, results, deck dialog, slide, Upload and Create. Typecheck and lint pass. Not a PR-05 implementation.
Documents/contracts changed: components/simulation.ts, Access switch in app/slide-vault, docs/DECISIONS.md.
Revisit trigger: When review tiers, AI labels or an AI provider are approved (D-03, D-12), or when the Postgres read path lands.
```

```text
Decision ID and title: FD-15 Brand orange follows the HTML mockup for now
Status: proposed
Decision date: (pending)
Decision owner/reviewer: (pending: UX lead + client confirmation from Alina Pak)
Context and evidence: The client asked us to match the supplied HTML mockup more closely (check-in notes, 2026-10-14). The mockup's brand colour is #FF3F0A (strong #E03408, tint #FFE6DC; dark theme #FF5A2C and #FF7048). An earlier change had set the app's orange to #EC672C, and docs/DESIGN_SYSTEM.md listed a different strong orange (#D93407).
Options considered: (a) follow the HTML mockup; (b) keep docs/DESIGN_SYSTEM.md values; (c) keep #EC672C.
Chosen outcome: (a) for now. --sv-brand is #FF3F0A and --sv-brand-strong is #E03408 in the light theme; the dark theme is unchanged. Colours remain tokens, so switching again is a one-file change.
Consequences for scope, cost, security and integration: Orange #FF3F0A on white is about 3.5:1, so it is only for non-text marks (icons, borders, focus rings); use --sv-brand-strong for orange text. This departs from the written design contract (DESIGN_SYSTEM.md normally wins over the HTML), so it needs the client's confirmation.
Acceptance evidence / affected PR criteria: Visual check of Home, browse lists and the account menu; contrast re-check for any orange text.
Documents/contracts changed: docs/design-tokens.css, docs/DESIGN_SYSTEM.md, docs/DECISIONS.md.
Revisit trigger: Alina confirms which palette to follow.
```

```text
Decision ID and title: FD-16 Quick AI search: Claude reads the request, Postgres finds the slides, the note comes from what matched
Status: proposed
Decision date: 2026-10-18
Decision owner/reviewer: Vincent (build), Schiffon (search engine), Khushali (search screen), Alina Pak (AI approval)
Context and evidence: On Oct 14 Alina asked for natural-language search with "why it fits" explanations for the Oct 21 midpoint. She approved Claude on the condition that training on our data is off, and our own API key is fine. pgvector (meaning-based search) is not enabled yet and is a question for the midpoint. FD-14's front end already simulates this reading in the browser.
Options considered: (a) Claude turns the request into keywords and filters, the existing full-text search runs them, and the note is built from what actually matched; (b) send slide text to Claude and let it pick and explain results; (c) wait for pgvector.
Chosen outcome: (a). GET /api/slide-vault/v1/smart-search?q= returns { reader, readerNote, plan, chips, relaxed, items: [{ slide, why, matched }] }. server/ai/claude.ts sends only the request plus the lists of client names and categories (no slide text, no files) and forces a structured search_plan answer; server/ai/search-plan.ts cleans it so filters can only be real values. Postgres matches ANY keyword (websearch_to_tsquery), inside the filters, best match first. If the filters leave nothing, it searches again without them and says so. With no ANTHROPIC_API_KEY, or if Claude fails or takes over 8 seconds, a rules-only stand-in (the same rules as FD-14's simulation) reads the request instead, so search always works.
Consequences for scope, cost, security and integration: One small, fast Claude call per search; slide content never leaves our database for quick search. The "why it fits" note can't claim something the slide doesn't say. Synonyms only help as far as the keywords Claude picks; meaning-based matching waits for pgvector. Deep Research (several searches, Claude reading and comparing candidate slides, a grouped answer) is the next step and would send slide text to Claude, so it needs the same training-off condition and a cost check.
Acceptance evidence / affected PR criteria: npm run test:smart-search (reader, cleaning, why-it-fits, fallbacks, and the Claude call against a fake API); smartSearchPg and listFilterValuesPg run against a local Postgres set up like M Moser's.
Documents/contracts changed: server/ai/search-plan.ts (new), server/ai/claude.ts (new), server/services/smart-search.ts (new), server/pg-repository.ts (smartSearchPg, listFilterValuesPg), app/api/slide-vault/v1/smart-search/route.ts (new), scripts/test-smart-search.mts (new), env.example, package.json.
Revisit trigger: pgvector enabled; the BD query scorecard shows misses; Deep Research approved; the search screen settles after the redesign.
```

```text
Decision ID and title: FD-17 Provider-neutral AI reader (replaces the Claude reader in FD-16), plus rate limits
Status: proposed
Decision date: 2026-10-19
Decision owner/reviewer: Schiffon (build), Alina Pak (AI provider approval, D-12)
Context and evidence: Alina's review of PR #2 (2026-10-19): M Moser does not use or have a Claude API. Keep natural-language reading behind a provider-neutral interface, keep retrieval, authorization and explanations independent of the model, make the provider a server setting, and changing providers must not need UI or database changes. M Moser has an OpenAI API, and a locally hosted open-source model such as Qwen3 is acceptable. The review also asked for rate limits and for search not to send the whole client-name list to the model. SECURITY_AND_OPERATIONS.md asks to rate-limit ingest, search and export by principal.
Options considered: (a) one PlanReader interface with an OpenAI-compatible adapter, which covers OpenAI and Qwen3 through Ollama's /v1 API; (b) separate adapters per provider; (c) keep Claude.
Chosen outcome: (a). server/ai/reader.ts defines PlanReader and reads SV_AI_PROVIDER (none by default, or openai-compatible with SV_AI_BASE_URL, SV_AI_MODEL, optional SV_AI_API_KEY and SV_AI_TIMEOUT_MS); a named but incomplete provider is an error, never a silent fallback. server/ai/openai-compatible.ts calls /chat/completions with Structured Outputs (response_format json_schema, strict) and ignores a reasoning model's <think> block. The model only sees client names whose first word appears in the request (relevantClients), so the full list never leaves the server. A model's filters are kept only when the request gives evidence for them (groundFilters): a typed category, "best of the best", a year or a word like "recent"; tested live, Qwen3 otherwise adds Best of the Best, a category and years nobody asked for. Optional SV_AI_REASONING_EFFORT is passed through as reasoning_effort; for local Qwen3 8B, none took a plan from 23-49s to 6-9s on a MacBook. Basic searches (four words or fewer and not a question, e.g. "team", "Kestrel Law 2024") never call the model; only sentences and questions do (isBasicQuery). Retrieval, filters, the stand-in fallback and "why it fits" are unchanged. server/ai/claude.ts and the ANTHROPIC_API_KEY setting are removed. The smart-search response's reader field is now 'model' | 'stand-in'. Rate limits (server/rate-limit.ts), per caller per minute: search 60, smart-search 20, export 10, upload 10, answered with 429 RATE_LIMITED, retryable, and a Retry-After header.
Consequences for scope, cost, security and integration: Default setup sends nothing to any AI provider. Using OpenAI with real M Moser content still needs M Moser's approval (D-12); a local Qwen3 keeps everything on M Moser's machines. Additive contract change: ApiErrorCode gains RATE_LIMITED. Known limits: counts live in one server process, so a multi-instance deployment swaps rate-limit.ts for a shared store or the host's gateway limits without route changes; until sign-in exists (FD-01) the caller is identified by forwarded address, and a host that passes a signed-in user should key on that user. No per-user deck visibility exists yet, so every caller can see every client; relevantClients limits what reaches the model, and the context function is where per-user filtering goes once access rules exist.
Acceptance evidence / affected PR criteria: npm run test:smart-search (config validation, adapter request shape and auth header, strict schema, only typed client names sent, <think> handling, refusals and API errors fall back without leaking the key, rate-limit windows and the 429 response) plus typecheck, lint, test:export and test:duplicates.
Documents/contracts changed: server/ai/reader.ts (new), server/ai/openai-compatible.ts (new), server/ai/claude.ts (removed), server/ai/search-plan.ts, server/services/smart-search.ts, server/rate-limit.ts (new), server/http.ts, contracts/dto.ts, app/api/slide-vault/v1/{search,smart-search,exports,uploads}, env.example, scripts/test-smart-search.mts, docs/DECISIONS.md.
Revisit trigger: M Moser picks the production provider and hosting; the app runs on more than one instance; sign-in or per-user deck access is added.
```
