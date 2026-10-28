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
Status: retired (2026-10-23)
Decision date: (pending)
Decision owner/reviewer: (pending: UX lead + technical lead)
Context and evidence: FD-13 left the v3 approval tiers, Access switch, AI "why it fits" lines, AI labels, most-downloaded rows and the upload label queue out of /slide-vault because the backend has no data for them. The client demo needs to show the intended experience.
Options considered: (a) show them in the real screens, simulated in the browser and marked clearly; (b) leave them in /v3 only; (c) add backend fields now.
Chosen outcome: (a). components/simulation.ts derives status (Approved, Suggested, Retired), sample download counts, suggested labels and a "smart search" reading (topics, client, year, "why it fits") from each slide's id, title, deck name and folder details. Real server keyword hits still count in the ranking. Everything simulated carries the orange "Simulated" mark. The shell's Access switch (Viewer, Editor, Curator) stands in for sign-in and changes the capabilities passed to the workspace: Editor adds metadata.edit (sees Suggested, can upload), Curator adds content.review and content.retire (also sees Retired). No contract type changes.
Consequences for scope, cost, security and integration: No data is saved, sent or read from a model. Statuses are not real approvals and must never be presented as such. Visibility by tier is a display filter only; authoritative authorization stays on the server (AGENTS.md). Replace simulation.ts with real review state, labels and AI search when D-03 and D-12 are decided.
Acceptance evidence / affected PR criteria: axe checks clean in light and dark on Home, results, deck dialog, slide, Upload and Create. Typecheck and lint pass. Not a PR-05 implementation.
Documents/contracts changed: components/simulation.ts, Access switch in app/slide-vault, docs/DECISIONS.md.
Revisit trigger: Retired 2026-10-23. Following Alina's review (2026-10-19: statuses and AI labels only if real), every simulated feature was removed: approval statuses (badges, the Status filter, the "Awaiting approval" and "Out of date" rows, and the tier filter that hid some real slides and blocked their download), the sample "Uploaded by" / "Contributed by" people, the suggested labels on the slide page and the simulated upload queue. Download counts, saved slides and My decks were already real (FD-18), and the smart search reader is real (FD-16, FD-17). The rules that remain (topic words for the stand-in reader and the "Slide type" filter) moved to components/search-rules.ts. "Your Top 10" and "Suggested for you" now show only when there is real activity or a saved slide behind them. Approvals themselves are still wanted, as a real feature (Schiffon, 2026-10-24): a named person with an approver role marks a slide or deck approved, suggested or retired, saved in the database (the slides table already has tag_status: suggested / approved), with who and when recorded. It needs M Moser sign-in (who is approving) and roles (who may approve), so it waits for their login and is on the handoff list for Alina; nothing simulates it in the meantime.
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

```text
Decision ID and title: FD-18 Real download counts, and saved slides, My decks and opt-in activity kept per person on the server
Status: proposed
Decision date: 2026-10-20
Decision owner/reviewer: Vincent (build), Khushali (screens), Alina Pak (data and privacy)
Context and evidence: Alina (Oct 20) asked for real metrics instead of simulated ones ("Most downloaded" is a good popularity signal), to keep saved slides and My decks, and for personal feeds to be opt-in, limited to each person's own ranking, with a retention period. Until now saved slides, My decks and the activity behind Top 10 lived only in each browser's localStorage, and download counts were simulated (simulation.ts simUsed).
Options considered: (a) keep everything in the browser; (b) store it per person in our Postgres schema, keyed to the signed-in person; (c) wait for M Moser's platform to provide storage.
Chosen outcome: (b). New tables in server/sql/schema.sql (npm run db:setup): slide_downloads (one anonymous running total per slide, no names), saved_slides, drafts (name plus ordered slide ids), user_settings (activity_opt_in, off by default) and activity_events (viewed, saved, downloaded). POST /exports adds one to each downloaded slide's total, and /search and /smart-search return it as SlideSummary.downloads. /me/saved, /me/drafts and /me/activity serve only the signed-in person's rows. Activity is recorded only after the person opts in, only used to rank their own rows, deleted after 90 days (checked on every write) and deleted immediately when they opt out. Rate limited (user-data policy, 120 per minute). The browser hooks in client/profile-store.ts keep the same shape: they now load from and save to the server, keep localStorage as a fast copy, move browser-only saved slides and decks to the server once, and fall back to browser-only behaviour when the server has no database.
Consequences for scope, cost, security and integration: Who is asking comes from server/principal.ts. Until M Moser's sign-in plugs in it reads the profile name the app sends in X-SlideVault-User, which keeps people's data apart for the demo but is not security; at integration only that function changes. Slide ids are stored as text (not foreign keys) because sample-library slides aren't in the slides table. The screens still show the sample count labels and have no opt-in switch yet: Khushali swaps simUsed for slide.downloads and adds the switch using activityOptedIn / setActivityOptIn from the workspace state. Download counts only start from the day this ships.
Acceptance evidence / affected PR criteria: npm run test:user-data against a local Postgres set up like M Moser's (role, schema, personal login): schema reruns, counts, per-person isolation for saved slides and decks, opt-in, 90-day purge and opt-out deletion. Typecheck, lint and the existing tests pass.
Documents/contracts changed: server/sql/schema.sql, server/user-data.ts (new), server/principal.ts (new), server/user-route.ts (new), server/rate-limit.ts, app/api/slide-vault/v1/me/* (new), exports, search and smart-search routes, contracts/dto.ts (SlideSummary.downloads, Draft, ActivityEntry, ActivityResponse, SIGNED_OUT, UNAVAILABLE), client/user-api.ts (new), client/profile-store.ts, components/state.tsx (passes the transport, exposes the opt-in), scripts/test-user-data.mts and scripts/check-mmoser-db.mts (new), package.json.
Revisit trigger: M Moser's sign-in is plugged in (replace userOf); a retention period other than 90 days; Most downloaded needs a time window ("this month").
```

```text
Decision ID and title: FD-20 Reasoning map: problem-solving search follows a written map, with a model only as the last resort
Status: proposed
Decision date: 2026-10-20
Decision owner/reviewer: Schiffon (reasoning design), Alina Pak (review)
Context and evidence: People ask for help with a situation, not only for words ("we just won a 30-day contract in a building that already has another tenant, which slides should I start with?"). Asking a model to work out the whole answer each time is slow and costs money per search. M Moser's business development team shared 16 example searches (2026-10-20) grouped under About M Moser, General Design, IDD, Methodology, MSA, SME and Case studies.
Options considered: (a) a written map, situation -> needs -> slide types, matched by trigger words, with one short model call only when no situation matches; (b) a model reasons out every answer; (c) keyword search only.
Chosen outcome: (a). server/ai/reasoning-map.ts holds slide types (grouped under M Moser's headings), needs and situations, every entry draft until a person reviews it against real decks. mapProblems() reports broken references. The search pipeline that uses the map (understand, match situation, needs to slide types, find and rank, explain) follows in later commits.
Consequences for scope, cost, security and integration: Most searches need no model call; a problem-solving question needs at most one short call. The map is plain data in the repo, so the team can extend it and Git keeps its history. It holds M Moser vocabulary, not client content. Tuning it on real decks happens on M Moser machines (local model or a person reading), not by sending decks to an outside service.
Acceptance evidence / affected PR criteria: npm run test:reasoning-map: the map holds together, all 16 example searches reach the expected slide type, and the 30-day example is recognised without a model and leads to timeline, occupied-building case study and logistics slides.
Documents/contracts changed: server/ai/reasoning-map.ts (new), scripts/test-reasoning-map.mts (new), package.json, docs/DECISIONS.md.
Revisit trigger: The team's situations arrive (2026-10-22); real decks show slide types or words the map lacks; the scorecard shows misses.
Decision ID and title: FD-19 The quick tour uses React Joyride
Status: proposed
Decision date: 2026-10-20
Decision owner/reviewer: Alina Pak (asked for it), Schiffon (build)
Context and evidence: Alina (2026-10-19): "I don't mind the walkthroughs. If you'd like to add them, can you implement them with React Joyride library? I think your current implementation is a custom tour." The custom tour measured targets on a timer and positioned its own card.
Options considered: (a) React Joyride 3.2.0 with the tour card in the workspace's own styles; (b) keep the custom tour.
Chosen outcome: (a). react-joyride@3.2.0, pinned exactly (supports React 19). Joyride handles placement, the spotlight, scrolling (leaving room for the sticky tabs), keyboard and focus; a custom tooltip keeps the same five steps, wording and look (.tour-pop, design tokens). It renders inside .slidevault so styles stay scoped. First sign-in starts it once; the header's tour button replays it; Escape, Skip or clicking the dimmed page closes it.
Consequences for scope, cost, security and integration: One new runtime dependency (MIT). The hand-written positioning code is gone. No contract changes.
Acceptance evidence / affected PR criteria: Browser check on the sample decks: all five steps show in order with focus inside the card, Done closes it, it doesn't restart after a reload once seen, the tour button replays it, Escape closes it. Typecheck and lint pass.
Documents/contracts changed: components/Tour.tsx, slidevault-extras.css (tour rules), package.json, package-lock.json, docs/DECISIONS.md.
Revisit trigger: Steps change, or the host platform provides its own onboarding.
```

```text
Decision ID and title: FD-21 Slides from several decks can download as one combined .pptx
Status: proposed
Decision date: 2026-10-21
Decision owner/reviewer: Vincent (build), Khushali (cart screen), Alina Pak (client)
Context and evidence: FD-09 sends slides from several decks as a .zip of one .pptx per deck, and the cart's "Combine into one deck" is marked as coming later. On Oct 14 we told Alina the final version would combine them into a single editable deck.
Options considered: (a) copy each slide with everything it depends on (layout, master, theme, images, charts) into one package, the way PowerPoint's "keep source formatting" does; (b) restyle every slide onto one master; (c) convert through LibreOffice.
Chosen outcome: (a). server/combine-pptx.ts takes the already-trimmed package of each deck (export-pptx.ts, so notes, comments and unpicked slides are already gone), uses the first as the base, copies each other deck's slides and their dependencies under fresh part names, registers the copied masters and slides with fresh unique ids, and puts the slide list in the cart's order across decks. POST /exports does this when the request has combine: true; without it the .zip is unchanged. Decks with different slide sizes (4:3 and 16:9) can't share a file without distortion, so then the .zip is sent and the X-SlideVault-Export-Note header says why.
Consequences for scope, cost, security and integration: Every slide keeps its own deck's design, so a combined file can contain several masters (normal in PowerPoint). Mixed slide sizes still come as a .zip. Hyperlinks from a slide to an unpicked slide behave as in single-deck exports. The cart button stays disabled until Khushali sends combine: true and shows the header's note when present.
Acceptance evidence / affected PR criteria: npm run test:combine (25 checks on the sample decks: order across two and three decks, each slide keeps its own master, unique slide/master/layout ids, no broken references or missing content types, chart data kept, nothing from unpicked slides, mixed-size fallback, the file opens and renders every slide in LibreOffice, and python-pptx reads it). Still to check by hand: opening a combined file in PowerPoint and Keynote, and on real Best of the Best decks.
Documents/contracts changed: server/combine-pptx.ts (new), server/services/export.ts, app/api/slide-vault/v1/exports/route.ts, contracts/dto.ts (ExportRequest.combine), scripts/test-combine.mts (new), package.json.
Revisit trigger: real decks show a layout or font problem in PowerPoint; M Moser wants mixed sizes converted rather than zipped.
```

```text
Decision ID and title: FD-22 Storyboard: a client situation becomes a story of slides, client first, with gaps flagged
Status: proposed
Decision date: 2026-10-21
Decision owner/reviewer: Schiffon (reasoning), Alina Pak and Grant Christofely (review)
Context and evidence: Client meeting 2026-10-21. Grant: "we often think in check boxes... the connection between those slides is zero... that's almost the worst crime we can commit", and he builds outlines in ChatGPT that "can't pull from our repository of slides". Alina: search by context and content, not direct keyword matching, and keep the model swappable. A needs scan of three real decks (local model, counts only) found about two thirds of slides prove experience and about one in ten addresses the client's challenge.
Options considered: (a) a story arc in our code (client challenge, insight, approach, proof, why M Moser, outcome), filled from the library part by part, with a model only reading the situation into parts; (b) a model writes the whole storyboard; (c) search results only.
Chosen outcome: (a). POST /api/slide-vault/v1/storyboard { situation, answers?, read? } returns { reader, readerNote, summary, questions, sections[{ role, label, title, need, items[{ slide, why, matched }], gap }] }. The client's own topics (situationTopics) are searched on their own and weighted by rarity so telling words ("hybrid") count more than common ones ("workplace"); each part's story words decide where a slide belongs; each slide is used once; a part with no slide is a gap, never a weak match; reasons start with what the part must prove and name only words found on the slide. Without a model, or if it fails, the rules build the same arc, and the reasoning map adds slide types for known situations. With read: true the configured model (OpenAI-compatible: local Qwen or OpenAI) reads the situation into parts and asks up to three questions about what it doesn't know (audience, the problem behind the project, what a win looks like); the rules ask the same questions when the situation doesn't answer them. SV_AI_STORY_TIMEOUT_MS (default 90s) gives this larger job its own limit.
Consequences for scope, cost, security and integration: One model call per storyboard at most; everything else runs without AI. The situation may contain client research, so a hosted model needs M Moser's approval (D-12); the local model keeps it on their machines. Additive contract types (StoryboardResult) and route. Not built yet: meaning search (pgvector), slide packs, picture or document input, the storyboard screen.
Acceptance evidence / affected PR criteria: npm run test:storyboard (25 checks: the whole story always, in order, even when a model repeats or skips parts; story order, slides used once, gaps, reasons, client topics found and filler dropped, clarifying questions asked and not repeated, model sections cleaned, fallback on failure, model never called without read, strict schema). On three real decks with the rules: all six parts filled, each led by the client's topics (hybrid, sustainability, cost).
Documents/contracts changed: server/ai/storyboard.ts (new), server/services/storyboard.ts (new), server/ai/openai-compatible.ts (shared chatJson), server/services/library-smart-search.ts, app/api/slide-vault/v1/storyboard/route.ts (new), contracts/dto.ts, env.example, scripts/test-storyboard.mts (new), package.json, docs/DECISIONS.md.
Revisit trigger: pgvector enabled (meaning search per part); slide packs and story-role tags exist; survey answers on how stories are built; picture input approved.
```

```text
Decision ID and title: FD-23 Deck facts filled in from the file, for the person uploading to confirm
Status: proposed
Decision date: 2026-10-21
Decision owner/reviewer: Schiffon (reasoning), Vincent (deck data), Khushali (upload form), Alina Pak (review)
Context and evidence: Client meeting 2026-10-21: the decks came with no metadata, nobody knows who made which deck, and Alina's direction is that SlideVault "reads Microsoft and fills in the client" on its own. Upload today only knows what the folder and file name say (FD-11, folder-path.ts). Tried on the 3 real decks: client and year found every time (file name, cover slide); the office only from the slides' text; the file's author field holds an M Moser company account, not a person, on all three.
Options considered: (a) rules read the folder, the file name, the cover slides and the file's own properties, then an optional AI reader fills only what is still empty, and every value is returned as a suggestion with its source for a person to confirm; (b) a model reads the whole deck and fills everything; (c) keep typing every fact by hand.
Chosen outcome: (a). POST /api/slide-vault/v1/uploads/suggest (file, folderPath?, read?) returns { suggestions: { client, year, category, bestOfTheBest, author, lastEditedBy, office }, reader, readerNote, slideCount }, each suggestion { value, source: folder | file name | file properties | slide text | ai, evidence }. Order of trust: folder, file name, cover slides (first 3: "prepared for / presented to / proposal for", the latest year), last-saved date. Template and company names are never treated as a person, M Moser is never the client. The AI (ai/deck-facts.ts, one strict Structured Outputs call with the file name and the first 4 slides' text) never replaces a rule's answer; its category must match the library's own list and its year must be plausible. Nothing is stored by this route; POST /uploads is unchanged.
Consequences for scope, cost, security and integration: Rules are free and instant; with AI on, one model call per file (about 8 seconds on the local model). Cover text may name the client, so a hosted model needs M Moser's approval (D-12). Because the file's author is a company account, "who made it" has to come from the person uploading (their login, editable); author, office and outcome need deck columns (Vincent, plan item 4) before they can be saved. The upload form pre-filling these with their source shown is Khushali's screen. Next integration steps on the same seam: SharePoint/OneDrive file metadata (created by, modified by) and the folder path from Vincent's ingest.
Acceptance evidence / affected PR criteria: npm run test:deck-suggestions (30 checks: folder, file name and cover rules, template, tool and company-account names, AI fills gaps only, bad AI answers dropped, end to end on a synthetic deck, fallback on failure, strict request shape). Real-deck run printed sources only, no values.
Documents/contracts changed: server/deck-suggestions.ts (new), server/ai/deck-facts.ts (new), server/services/suggest-deck.ts (new), server/services/library-smart-search.ts, server/rate-limit.ts (uploadSuggest), app/api/slide-vault/v1/uploads/suggest/route.ts (new), scripts/test-deck-suggestions.mts (new), package.json.
Revisit trigger: deck columns for author, office and outcome exist; the upload form is redesigned; SharePoint metadata is available; Alina names the offices list.
```

```text
Decision ID and title: FD-24 Storyboard tab: talk to it, and tell it what was helpful so it learns
Status: proposed
Decision date: 2026-10-21
Decision owner/reviewer: Schiffon (reasoning and storyboard design), Khushali (UI review: a new tab in her navigation), Vincent (story_feedback table), Alina Pak (review)
Context and evidence: FD-22 built the storyboard with no screen. Trying it, Schiffon wanted it as its own tab in the app, slides she can preview and pick like on Home, a reason for each slide, a way to say whether a suggestion helped ("we want to constantly be training the AI to internally know what's really good for the company"), and a chat she can talk to instead of typing answers. Grant's own example (21 Oct): an outline built in ChatGPT that "can't pull from our repository of slides".
Options considered: (a) a Storyboard tab reusing Home's SlideCard, the AI's questions as a chat, "Right for this part?" on every slide stored without names and used to rank the next similar storyboard, and speech through one swappable OpenAI-compatible setting with Whisper on the laptop by default; (b) the browser's built-in speech recognition (Chrome sends audio to Google, so a brief naming a client leaves M Moser); (c) feedback tied to each person's opt-in activity (FD-18), which would lose it for everyone who hasn't opted in.
Chosen outcome: (a). Tab "Storyboard" (view story): describe the situation or talk; while the AI works the six parts show in order with a light moving down them; then each part shows its number, label, heading, "This part must show", up to three SlideCards (preview, tick to add, save, why it fits), "Right for this part? Useful / Not right", "None of these fit this part", or "Proof needed" for a gap; "Add the story to the draft deck" adds each part's lead slide in story order. Chat: the AI's questions as messages, answers by typing or talking rebuild the story. POST /storyboard/feedback { role, slideId, verdict, topics } stores the part, slide, verdict and the brief's topic words only (never the brief, never a person) in story_feedback, or in the data dir until that table exists; buildStoryboard ranks what colleagues marked useful for that part on briefs sharing a topic first, "not right" last, and says so in the reason. GET/POST /speech: a WAV recorded in the browser (16 kHz mono) goes only to SV_SPEECH_BASE_URL's /audio/transcriptions.
Consequences for scope, cost, security and integration: Speech is free and private with local Whisper (whisper-server --inference-path /v1/audio/transcriptions); pointing it at Azure OpenAI or OpenAI is a setting, needing M Moser's approval (D-12) since people will speak about clients. The mic button hides when speech isn't set up. Feedback learns by counting, not by training a model, so it works with any model and can be inspected or cleared; it learns patterns, not causes (an outcome is evidence, not a verdict). story_feedback needs npm run db:setup on M Moser's database (Vincent). The new tab changes Khushali's navigation and is hers to review before it ships; Create is still a placeholder and could host this instead.
Acceptance evidence / affected PR criteria: npm run test:story-learning (24 checks: feedback cleaning, learning only from similar briefs and per part, ranking and reasons, failure never stops the storyboard, speech settings, request shape, no key to a local service, failures reported). npm run test:storyboard. Local Whisper transcribed a spoken test sentence exactly.
Documents/contracts changed: components/StoryboardView.tsx (new), components/storyboard.css (new), components/SlideVaultWorkspace.tsx (tab, view), contracts/runtime.ts (View story), app/slide-vault/shell-config.ts, client/api.ts, client/wav-recorder.ts (new), server/ai/speech.ts (new), server/story-feedback.ts (new), server/services/storyboard.ts (learned), server/services/library-smart-search.ts, server/sql/schema.sql (story_feedback), server/rate-limit.ts, contracts/dto.ts, app/api/slide-vault/v1/speech/route.ts (new), app/api/slide-vault/v1/storyboard/feedback/route.ts (new), scripts/test-story-learning.mts (new), env.example, package.json.
Revisit trigger: Khushali's review of the tab; Schiffon's storyboard design; the outline-picture input; enough feedback to show per-part "most useful" lists; M Moser picks a hosted speech service.
```

```text
Decision ID and title: FD-25 One storyboard, tuned to who is building it
Status: proposed
Decision date: 2026-10-21
Decision owner/reviewer: Schiffon (reasoning), Khushali (profile screen review), Grant Christofely and Alina Pak (review)
Context and evidence: Grant named three groups on 21 Oct (12:51-16:23): business developers meet, research and pursue clients; directors lead the proposal's story, capabilities and pricing; BD support and marketing pull slides from the master deck, order them and clean them up, and will be the heaviest users. Schiffon: the storyboard must fit everyone in the organisation, not one person, and get smarter from each role's choices, all on M Moser's own machines.
Options considered: (a) one engine with a small per-role tuning table (words each part looks for, options per part, which questions are worth asking), the role set once in the profile, and feedback weighted toward people in the same role; (b) a separate prompt or model per role; (c) no roles, one tuning for all.
Chosen outcome: (a). server/ai/roles.ts ROLE_TUNING: business developer (client challenge and insight words, a question about past work with the client), director (capabilities and team for why M Moser; cost, fees, value and savings for the outcome; a question about budget and sign-off, asked first), BD support (5 options per part, at most one question). POST /storyboard takes role; feedback records by_role (role only, never a name); learnedFrom counts a same-role verdict twice and every other verdict once. "How you build proposals" in My decks sets it (StoryRoleSetting); the storyboard says what it was tuned for and links to change it.
Consequences for scope, cost, security and integration: No extra model calls; works the same with any model. The role is kept in the browser per signed-in name until M Moser's login and user_settings carry it (Vincent). story_feedback gains by_role (npm run db:setup). The tuning is a first guess from the meeting; the BD survey's answers should refine it.
Acceptance evidence / affected PR criteria: npm run test:story-learning (role checks: known roles only, same-role weight, 5 options for support, at most one question for support, a director's outcome leads with fees and value, the budget question asked only when the brief doesn't say, learning asked per role). npm run test:storyboard.
Documents/contracts changed: server/ai/roles.ts (new), server/services/storyboard.ts, server/story-feedback.ts, server/sql/schema.sql (by_role), server/services/library-smart-search.ts, app/api/slide-vault/v1/storyboard/route.ts, client/api.ts, client/role-store.ts (new), components/StoryRoleSetting.tsx (new), components/ProfileView.tsx (one line), components/StoryboardView.tsx, components/storyboard.css, contracts/dto.ts, scripts/test-story-learning.mts.
Revisit trigger: BD survey answers; the role moves to the server profile; more roles appear (client services).
```

```text
Decision ID and title: FD-26 The storyboard uses what the local model read on each slide
Status: proposed
Decision date: 2026-10-21
Decision owner/reviewer: Schiffon (reasoning), Vincent (where the readings live once on the server), Alina Pak (review)
Context and evidence: The discovery scan (local Qwen, on this machine) read all 204 slides of the three real decks: what each shows, what it convinces a client of, its role in a story, its topics. 53 are dividers and 17 admin pages, which word matching could put into a story. Alina added more decks on 21 Oct; Schiffon wants more data to tighten the logic.
Options considered: (a) the storyboard reads the scan (data dir, never the repo): a slide read as doing a part can fill it without the part's words, the brief can match what a slide is about, dividers and admin pages are never proof, and the reason says "Read as: ..."; (b) keep word matching only; (c) send slides to a hosted model at story time.
Chosen outcome: (a). server/slide-knowledge.ts loads discover-scan.json (cached by file time); buildStoryboard takes knowledge { of, forPart }; ranking is colleagues' verdicts, then the brief, then the model's reading, then the part's words. On the real decks, Grant's hospital brief: 8 of 18 slides placed because they were read as doing that part, all 18 matching the brief, no dividers.
Consequences for scope, cost, security and integration: No model call at story time; the reading is done once per slide when decks arrive, on M Moser's own machine, and re-run only for new slides. Slide descriptions stay on the server. On the hosted app the readings belong in Postgres beside each slide (Vincent), written at upload.
Acceptance evidence / affected PR criteria: npm run test:storyboard (knowledge checks: a slide read as the client's challenge fills that part without its words, the reason says how it was read and the brief matches what the slide is about, a divider titled "Case studies" is never proof).
Documents/contracts changed: server/slide-knowledge.ts (new), server/services/storyboard.ts, server/services/library-smart-search.ts, server/services/fixture-smart-search.ts (fixtureRowsWhere), server/folder-path.ts (MSA folders), scripts/test-storyboard.mts.
Revisit trigger: the scan runs at upload; readings move to Postgres; the regrouped categories become tags.
```

```text
Decision ID and title: FD-50 Hidden-in-source slides left out by default; archived decks; year from "<Category> <Year>" folders
Status: proposed
Decision date: 2026-10-22
Decision owner/reviewer: Vincent (build), Khushali (screens and archive in the app), Grant Christofely and Alina Pak (21 Oct check-in)
Context and evidence: At the 21 Oct check-in Grant agreed that slides hidden in the original decks are usually internal notes or checklists, and that showing them only on request is "a good solution". The Kestrel Law test deck from setup needs to leave the app, but M Moser's bucket can't delete files. Alina added Design Consultancy 2025, IDD, MSA and SME folders to the Drive.
Options considered: hidden slides: (a) leave them out unless asked for, (b) rank them lower, (c) warn on download. Taking decks out of view: (a) an archived_at column, (b) deleting rows (the file would stay in the bucket, orphaned), (c) a new status value (needs a schema check change).
Chosen outcome: (a) and (a). GET /search and GET /smart-search leave out hiddenInSource slides unless hidden=include; client/api.ts listLibrary and smartSearch take includeHidden for a future "Show hidden slides" switch. decks.archived_at: archived decks are left out of every library, search, filter and duplicate query; scripts/archive-deck.mts (npm run deck:archive) archives or restores by title, with a dry run unless --yes. folder-path.ts adds MSA and reads the year from a folder named like "Design Consultancy 2025".
Consequences for scope, cost, security and integration: Hidden slides no longer appear anywhere in the app until the UI offers the switch (Khushali), including on deck pages, so a deck's slide numbers can skip. Archiving hides, never deletes, and can be undone. Khushali's archive-in-the-app work can build on the same column.
Acceptance evidence / affected PR criteria: test:folder-path (new folder cases), typecheck, lint and the existing tests; the archive script and hidden filtering checked against a local Postgres set up like M Moser's.
Documents/contracts changed: server/sql/schema.sql (decks.archived_at), server/pg-repository.ts, search and smart-search routes, client/api.ts, server/folder-path.ts, scripts/archive-deck.mts (new), scripts/check-mmoser-db.mts, scripts/test-folder-path.mts, package.json.
Revisit trigger: M Moser wants some hidden slides searchable by default; archive moves into the app.
```

```text
Decision ID and title: FD-28 Reviewed slide metadata guides the storyboard: roles that hold, and slides that never go in a story
Status: proposed
Decision date: 2026-10-23
Decision owner/reviewer: Schiffon (metadata and reasoning), Vincent (where it lives once on the server), Alina Pak (review)
Context and evidence: Testing Grant's hospital brief on real decks, the storyboard placed a team member's résumé as "the client's challenge": the résumé listed hospital projects, so it matched the brief's words, and nothing said what kind of slide it was. Schiffon built a reviewed metadata file for 13 real decks (919 slides): slide type, story role, reuse status (reusable, check currency, client-specific, internal - never show), flags (a leftover client name, text only in an image), themes, sectors, projects, near-duplicate groups and slide packs. Across those decks 3% of slides speak to the client's challenge and 24% are admin pages.
Options considered: (a) load the metadata beside the local model's reading (FD-26) and let a reviewed role decide which part a slide may fill; (b) keep word matching and down-rank admin slides; (c) wait for the metadata to live in Postgres.
Chosen outcome: (a). A data-prep step (outside the repo, because it reads real decks) matches each CSV deck to a library file by content, then each row to a slide by number, and writes slide-metadata.json beside library.json. server/slide-knowledge.ts merges it with discover-scan.json: the reviewed role wins, and themes, sectors and projects join the topics. In buildStoryboard a slide with a reviewed role only fills that part unless colleagues marked it useful elsewhere (FD-24 still leads); "internal - never show" slides and slides flagged as naming another client never appear, whatever the votes; covers and contents join dividers and admin as never-proof. The client's sector is read from plain words in the brief ("hospital" -> healthcare, rules only) and proof from that sector leads its part, after colleagues' votes; each such slide says "Same sector as your client".
Consequences for scope, cost, security and integration: No model calls. Slides without reviewed metadata behave as before. The metadata covers only decks whose files are in the library: 6 of the 13 for now (310 slides). On the hosted app the fields belong in Postgres beside each slide (Vincent), filled at upload and confirmed by a person.
Acceptance evidence / affected PR criteria: npm run test:storyboard (metadata checks: a résumé matching the brief is never placed, an internal-only slide never appears, a slide naming another client never appears even with votes, reviewed slides fill only their own part, colleagues' votes still override a reviewed role).
Documents/contracts changed: server/slide-knowledge.ts, server/services/storyboard.ts, scripts/test-storyboard.mts, docs/DECISIONS.md.
Revisit trigger: the other decks' files are added; the metadata moves to Postgres; upload suggests these fields (FD-23).
```

## FD-29: Every storyboard slide must speak to the brief (2026-10-23)

Context and evidence: On Grant's hospital brief, parts were filled with slides that only did the part's job: a case study for another sector as proof, an architect's profile as "why us", a résumé a colleague had marked useful as the client's challenge, and one slide copied into two decks shown twice. The six parts were deciding what went in; the brief was not.

Chosen outcome: The brief is read for the needs it names (healthcare, bringing sites together, staff wellbeing, the board, cost and budget, a past project gone wrong, and a few others), each found on slides by the words decks use for it. A slide fills a part only if it does that part's job and speaks to the brief: a need it names, the client's sector, the brief's own words, or colleagues' votes. Rarer needs weigh more than common ones ("healthcare" over "cost"); in the proof, same-sector work leads. A slide reviewed as page furniture (résumé, admin) is never voted into a story. Copies of one slide are shown once, and a slide that fits several parts goes to the part it fits best. Each slide says "Speaks to: ..." so the reason is visible. Parts offer up to 30 slides in all, weighted: approach and proof up to 8, challenge and why us 4, insight and outcome 3.

Consequences: Parts with nothing about this brief stay short or empty rather than padded. The need words are a hand-made list; the AI choosing and ordering from the shortlist is the next step.

## FD-30: The AI tells the story; the parts only order it (2026-10-23)

Context and evidence: Schiffon's review of the storyboard (23 Oct) and her screen recording of the design she wants: the page should read like the deck it becomes, not a grid of parts. "The logic is how you make the storyboard, and then the AI is what actually makes the storyboard." The six parts (challenge, insight, approach, proof, why us, outcome) were shown as sections and filled by a ranking formula, so the result read as a checklist. Her reviewed metadata of 13 real decks shows the common spine the firm's proposals follow (cover, client understanding, approach, team, case studies, closing), with about half of each deck being RFP-required pages.

Chosen outcome: The rules (FD-28, FD-29) build a shortlist of slides that speak to the brief, part by part. A second model call composes the story from that shortlist: a name for it, then 5 to 8 beats, each with a title in the client's terms, one lead slide, up to four slides behind it, what to say to the client, why the slide is there and which words of the brief it answers. The model sees short codes, never library ids; any code not on the shortlist is dropped, each slide is used once, beats are put back in client-first order, labels and slide codes are stripped, and narration is cut at a whole sentence. If the model fails or returns fewer than three beats, the rules build the same beats (grouped by project or slide type, titled in the client's terms). Same-sector past work leads the proof beat whatever the model chose. The page shows only the story: title, then each beat's slide large, what it matches, the narration and why; clicking a slide shows the slides behind it. Keep, swap ("Lead with this") and remove are recorded as feedback for the beat's part (FD-24). "Read by AI", part counts, the AI checkbox and the side chat are gone; questions sit under the story as "Make it sharper". Recent stories are kept in the browser per signed-in name, as the role is (FD-25).

Tightened 24 Oct after the team's demo review: each beat said why its slide was there but not how the slides connect, so the reader still had to work out the argument. The story now has a thesis (one sentence: what the whole proposal must convince the client of) and every beat a bridge (how it follows from the beat before; for the first, why the story starts there). The AI writes both when it composes; a bridge only stands where its beat still follows the beat it was written after once the app puts the story in client-first order, otherwise the rules write it. The rules' thesis and bridges say the brief's needs in plain words ("what their people are going through", "for a hospital", "cost certainty"), never the needs' labels. The page shows the thesis under the title and each bridge as one quiet line above its beat.

Carried further 24 Oct (with FD-32): the proof argues for this client and the story ends on the outcome. Every case study's "why this slide" says whether it is direct (the same kind of client) or transferable, and what it shows for this client ("Transferable: a different kind of client, but it shows we know what it takes to bring their sites together"); the AI is told the same and to tie each case study to the thesis. Every story, new or retold, ends on a closing line: what the client gets in their terms ("In the end, they get one organisation across every site..."), written by the AI or by the rules from the brief's needs, and left out when the brief names nothing it could honestly promise.

Consequences: With the local model (qwen3:8b on a 16 GB Mac) a story takes about two to three minutes and needs Ollama's context at 16k tokens (OLLAMA_CONTEXT_LENGTH=16384); the story timeout is set with SV_AI_STORY_TIMEOUT_MS. RFP-required pages (résumés, fees, schedule, legal) are not yet offered as an appendix.

## FD-31: Discover, retrieve, reimagine: one library, three outcomes (2026-10-24)

Context and evidence: Testing with the Moody's RFP, Schiffon asked for the original 82-slide deck and the storyboard returned 19 new slides, 5 of them from Moody's. The storyboard had replaced retrieval instead of adding to it: it couldn't tell "show me the Moody's proposal from 2025" from "build a new proposal", it identified decks by slide words (Moody's branding is a logo, not text), and it capped every answer at 30 slides although the real decks run 60 to 110. Client, year and kind were also unknown for most real decks, so Home's browse and suggestion rows were empty.

Chosen outcome: One deck-identification layer for every deck, no special cases. A deck catalog (deck-catalog.json in the data dir, built from the reviewed metadata) gives client, year, kind and a name ("Moody's · RFP, HQ relocation/renovation · 2025"); decks it doesn't cover get the same facts from their folder and file name (dates like 06202025 or 071526, RFP or MSA in the name, PDFs too). Every slide summary and the library listing use these facts (search.ts deckFacts), so search, browsing and the AI agree. deck-finder.ts finds decks from a plain request by client name (any name the deck goes by, apostrophes optional, the file's own spelling, project names), year ("last year" too) and kind; copies of one file show once. Basic search shows matching decks above the slide results ("Moody's proposal 2025", "Next Level Games", "all proposals from 2025"); a year the client has no deck from shows its other decks and says so. The storyboard first decides what is asked (ai/deck-request.ts): retrieve an existing deck as saved (open it whole, or "Tell its story better"), reimagine it (every slide used: story pages in client-first order, the pages that aren't story, such as cover, contents, résumés, fees, schedule, legal and scope, after it in the deck's order, and only parts the deck never covers filled from other decks, labelled "Not in the original"), or build a new story from the whole library. A new pitch to a client we already have a deck for still builds. Retrieval has no slide cap.

Amended the same day after testing "Intuit and Marvel are merging, tell the story of that" (retold only Marvell's deck) and "Moser and Intuit are combining... prove we're the right ones... an outline for the proposal" (opened Intuit's old deck): retrieve and reimagine apply only when the request names one client's deck and is about that deck itself. A new situation (merging, combining, a pitch, "prove", an outline for a proposal) or several clients builds a new story, and the decks we already made for the named clients are its context: their own slides lead the client's situation, insight and approach (marked "From the deck we made for this client"); proof still follows the brief. A retold deck gives the rest of the library its own description, so parts the deck never had are still filled.

Consequences: Identification is only as good as the catalog and file names: a deck with neither a reviewed entry nor a client in its name is found by its title only, and one with no date anywhere has no year rather than a guessed one. Recognising client logos on slides is not built; reviewed metadata is used first because it exists. Every new deck run through the same tagging improves all three outcomes at once.

## FD-32: Retelling a deck keeps it whole and weaves the story through it (2026-10-24)

Context and evidence: FD-31's retelling put a deck's story pages in client-first order and moved the rest (cover, résumés, fees, legal, scope) to the end. Reading two real decks for their story (Schiffon's story analysis, 24 Oct) showed every proposal is two things at once: the boxes an RFP requires, often in the RFP's own order, and the one idea that should run through them. The decks lose where the story stops once the paperwork starts: the central idea disappears after the first chapter, case studies never say why they matter to this client, and the close is a list instead of the outcome. We do not have M Moser's RFPs or their own checklist, so we cannot know which pages or order are required.

Chosen outcome: A retold deck keeps every slide where it was, in the deck's own sections (split at its dividers and wherever it turns from story to required pages or from one part to the next). The story is woven through instead: a thesis, and a line opening each section that ties it back (proof is asked to say what it shows for this client; the last story section closes on what they get). Pages that aren't story are marked "Kept as is" and say what they are. A part the deck never had is offered as a "Suggested addition", with slides from other decks, at the point where that part belongs; it is never slipped in silently. The AI writes the thesis and each section's title, opening line and narration; it can never drop, merge or move a section, and any section it skips gets the rules' line. With no needs in the request ("the story of Moody's"), the thesis comes from the deck's own most common reviewed themes. "Add the story to the draft deck" adds every slide of a retold deck, in the deck's order.

Consequences: Retelling is now safe for decks that answer an RFP with a required order. No checklist is hard-coded: when M Moser shares their RFPs or their own checklist, they become one more input that tightens the weave (which sections are required, what each must answer). Weaving a long deck is one larger AI call; on the local model it times out, so it needs the hosted model. A retold deck made from a PDF still can't be downloaded as editable PowerPoint (FD-08 rules for PDFs).

## FD-33: Search uses what is known about each slide, not only its words (2026-10-24)

Context and evidence: Vince's test searches (24 Oct) showed home search only matched words in a slide's title and text: "team slide for a healthcare client" returned résumés from other sectors, "case study where the building stayed occupied during construction" returned approach slides, and "sustainability slides for a bank" returned filler. The storyboard already used the reviewed metadata (FD-28) and the local model's reading of every slide (FD-26); search did not.

Chosen outcome: A search is read for what it asks for beyond its words (server/services/slide-intent.ts, rules only): a kind of slide (team, résumé, case study, approach, fees, references, schedule, about the firm, risk), a client's sector ("for a bank", "healthcare client") and a theme (sustainability, wellbeing, hybrid, workplace strategy, cost certainty, smart building, amenities, brand). On the library decks, what the local model read on each slide is searched with its words, slides of the kind asked for rank ahead of word matches (a "team slide" puts the team structure before résumés; a résumé search, résumés), then the client's sector (the proof's sectors or the sector of the client the deck was made for), then theme; a slide that answers all of what is asked is let in even when none of its words match. Never-show pages and slides that still name another client stay findable, ranked last. Each result says what it is in the search's terms first ("A team slide for the same kind of client."). Accents are ignored when reading a request ("résumé").

Consequences: Uploaded decks in Postgres are still matched on words only until the metadata and readings are imported there (Vince's import). The kinds, sectors and themes are a hand-made list; meaning search (pgvector) is the next step for requests the list doesn't cover.

## FD-34: Honest misses: say when the library has no such deck (2026-10-24)

Context and evidence: Vince's test searches (24 Oct): "Google proposal" returned eleven slides that mention Google without saying we have no Google proposal, "proposals from 2019" returned nothing without saying why, and the storyboard, asked "Show me the Google proposal", quietly built a new story about Google.

Chosen outcome: deck-finder.ts reports what a deck request asks for that the library doesn't have: a name written like a name ("Google") that no deck goes by, and years with no decks. Lower-case words are topics ("hospital proposal") and a place after "in"/"at" is a location ("proposals in Vancouver"), so neither is ever reported as a missing client; a name with no deck word ("Google") stays a slide search. Home search says "No Google deck in the library." above the results, adding "The slides below mention it." when slides do; "No decks from 2019 in the library." for years. The storyboard answers a request for a deck we don't have with that same sentence and "Build a new story instead" (mode=build, which builds whatever the request names), never with a story in its place. A new pitch to a client we have no deck for still builds.

Consequences: A name typed in lower case ("google proposal") is read as a topic, so it gets slide results without the miss sentence. Locations become deck facts in a later step.

## FD-35: Where the client is, as a deck fact (2026-10-24)

Context and evidence: Vince's test "proposals in Vancouver" found nothing: the app did not know where any deck's client was, although the reviewed metadata has a location for every deck it covers and M Moser's file names often carry a city code (M Moser_Intuit_NY_RFP_2025, M Moser_Scotiabank_MSA_TO_2025).

Chosen outcome: Location joins client, year and kind as a deck fact: the deck catalog's reviewed location first, then a city code or name in the file name (NY, SF/SFO, TO, VC, Vancouver, Global and a few more). It is carried on every slide's provenance and the library listing. The deck finder finds decks by place ("proposals in Vancouver", "New York proposals", "decks from Toronto", with a year too) when the request asks for decks or the place follows "in", "from" or "at"; a named client always wins, so "New York Times" is never read as New York, and a place in a slide search ("global delivery approach") shows no decks.

Consequences: Decks with neither a reviewed location nor a city code in the file name have no location (Cognizant, Design Build) rather than a guessed one.

## FD-36: The builders' deck as a test: rare words count, packs stay together, parts aren't padded (2026-10-24)

Context and evidence: To prove the logic on slides that aren't M Moser's, our own presentation (27 slides, "SlideVault - Three Builders One Mission") went into the library as 27 single-slide files (split with SlideVault's own export, so no whole deck can be handed back), tagged in the same schema as the reviewed metadata (own_slides_metadata.csv in the data dir) with readings in the scan's format. Asked "There are three people that were assigned to build an app for this firm. Please tell the story of those people.", the storyboard picked 0 of them. Four causes: words under four letters were dropped, so "app" was never searched; word-start matching made "app" match "approach" and "appendix"; every word counted the same, so "people" (218 slides) and "build" (407) drowned out rare ones; and the storyboard's own search, unlike home search (FD-33), never searched what was read on each slide. Two more showed once those were fixed: a part's slide limit split a pack (the three builder slides), and parts filled their space with weak matches.

Chosen outcome: Three-letter words that mean something are kept ("app", "lab"), filler is not; a word of three letters or fewer must be the whole word, in the search and in the relevance score. Each search word weighs by how rare it is in the library. The storyboard searches the brief's words in what was read on each slide too, and looks at the 120 best matches instead of 60. A slide must score at least 30% of the best match in its part on the brief's words unless it meets a need, is the client's sector or their own deck, or colleagues voted it useful. A part that has started a pack (reviewed metadata "pack") takes the rest of it even past its limit. Result: the builders' story uses 16 of our slides in 19, all three builders together; Grant's hospital brief still uses none of them.

Consequences: Our deck stays in the library as a worked example and a demo; its client is "SlideVault team", so no request about M Moser retells it. The metadata tools now take several CSVs in the same columns.

## FD-37: Storyboard feedback teaches only from people who turned learning on (2026-10-24)

Context and evidence: FD-24 saved every Useful / Not useful verdict without a name, reasoning that anonymous feedback needed no opt-in. Khushali's demo review (24 Oct) asked that clicks retrain the storyboard but not for people who opted out. SlideVault is opt-in (Alina, 19 Oct): nobody is in until they turn "learn from my activity" on, so "not if opted out" means "only if opted in". Verdicts also shape everyone's storyboard, which sits closer to Alina's "your activity only shapes your own ranking" than anonymous counting suggested.

Chosen outcome: On M Moser's setup (database configured) a verdict is stored only when the signed-in person has turned learning on; signed out, never opted in, opted out, or if the setting can't be checked, nothing is stored and the route answers { saved: false, reason: 'opted-out' }. The mark still shows on screen, and the person is told once per story: "Not saved: learning from your activity is off. You can turn it on in Settings." With no database (a laptop demo) there are no people or settings, so verdicts are kept on that computer as before. Stored verdicts keep teaching the next storyboard for a similar brief (FD-24, FD-25).

Consequences: Learning grows only as people opt in. The Settings text for the activity switch should say it also lets Useful / Not useful teach the storyboard (Khushali's screen; flagged to her).

## FD-38: Slide packs: slides that only work together are offered and kept together (2026-10-24)

Context and evidence: The 21 Oct check-in asked for a way to show slides that belong together as a set (Grant: if one is picked, the others have to go with it, in a particular order). M Moser has not supplied any grouping. Vincent's `vincent-story-data` branch (FD-33 there) already has `slide_packs` and `slide_pack_members` tables with an order and a suggested or confirmed status; this entry is the front end and the route contract that sit on top of them.

Options considered: (a) a pack is stored data, made by the system as a suggestion and by people in the app, shown on cards, offered whole when one slide is added, and kept together in the draft deck; (b) always add the whole pack with no question; (c) leave grouping to tags only.

Chosen outcome: (a). Every slide carries `pack?: { id, label, status: 'suggested' | 'confirmed', slideIds }` (contracts/dto.ts, PackRef; the same ordered `slideIds` on every member). Adding one slide of a pack asks "Add all N slides" or "Only this slide". The slide page and the large preview have "Add whole pack (N)". The draft deck groups a pack under a label, moves it as one block, and asks before one slide of it is removed. For the MVP any signed-in user can group slides in one deck, in the order they click them, and ungroup a pack. The front end calls POST /packs, PATCH /packs/:id and DELETE /packs/:id; while the server answers 404, 405 or 501 the change is kept in this browser and marked "This browser only". `?demopacks=1` in the address shows pretend packs for demos. A suggested pack can be confirmed by any signed-in user ("Confirm this pack") and a confirmed one moved back to suggested ("Unconfirm"), through PATCH /packs/:id { status }; the server records who and when and the screen shows "Confirmed by … · date". Ungrouping a suggested pack is "Dismiss suggestion": the server should remember it as dismissed so it is not suggested again and the Storyboard stops pairing those slides (agreed with Schiffon, 25 Oct).

Consequences for scope, cost, security and integration: No model call. Packs are visible to everyone who can see the slides. Writes by any user are an MVP simplification; who may create, confirm and ungroup is a tier decision for M Moser (notes.md, "Hand-off notes for Alina"). The server must check that all slides are in one deck, that a slide is in at most one pack, and record who made each change.

Acceptance evidence / affected PR criteria: typecheck and lint; checked in a browser with pretend packs: the badge, the add question (add all, only this one), the remove question, the pack kept together and moved as one block in the draft deck, the slide page panel and Add whole pack, ungroup, and creating a pack from a deck page. The server routes are not built yet, so create and ungroup were not run against a real server.

Documents/contracts changed: contracts/dto.ts (PackRef, SlideSummary.pack), client/api.ts (createPack, renamePack, deletePack), client/pack-store.ts and client/packs.ts (new), components/Packs.tsx (new), parts.tsx, Cart.tsx, Views.tsx, Dialogs.tsx, state.tsx, docs/DECISIONS.md, notes.md.

Revisit trigger: Vincent's pack routes are live; M Moser decides who may create, confirm and ungroup packs; real packs arrive from an import.

## FD-39: Archive and restore decks from the app (2026-10-25)

Context and evidence: FD-32 added `decks.archived_at` and a script to archive a deck, and said the archive-in-the-app work would build on it. Alina asked for a Curator archive option (recap, 17 Oct). M Moser's bucket cannot delete files, so archiving is how a wrong or test deck leaves the app.

Options considered: (a) buttons in the app that ask the server to archive or restore, with no pretend version while the server cannot; (b) also hide decks in the browser when the server cannot (rejected: a deck hidden for one person in a shared library would mislead); (c) keep it a script.

Chosen outcome: (a). An "Archive deck" button on the deck page and a small archive button on each deck card open a confirmation ("hidden from the library, search and AI for everyone; nothing is deleted; restore any time"). Archiving shows a toast with Undo. A "Show archived decks" switch in the filters' More panel brings archived decks back into the lists, marked "Archived", with a Restore button. The slide page's Details panel has "Archive this deck (N slides)", and the dialog says it hides the whole deck. A page of its own, "Archived decks" in the profile menu (/slide-vault/archive), lists every archived deck with a Restore button on each; it asks the library for archived=only. The front end calls PATCH /decks/:id with { archived: true | false } and asks the library for archived decks with archived=include (lists) or archived=only (the Archived decks page); a deck then carries provenance.archived on each slide, and ideally archivedAt and archivedBy. While the server answers 404, 405 or 501 nothing changes and the person is told. Everyone signed in can archive for the MVP (a tier decision for M Moser, see notes.md).

Consequences for scope, cost, security and integration: No model call. The server must do the hiding and restoring, return archived decks only when archived=include, and record who archived and when. Slides already in someone's draft deck stay there.

Acceptance evidence / affected PR criteria: typecheck and lint; checked in a browser: the dialog, the honest message when the route is missing, the More switch. The route does not exist yet, so archive and restore were not run against a real server.

Documents/contracts changed: contracts/dto.ts (Provenance.archived), client/api.ts (archiveDeck, includeArchived), components/ArchiveDialog.tsx (new), state.tsx, Views.tsx, parts.tsx, FilterBar.tsx, icons.tsx, docs/DECISIONS.md, notes.md.

Revisit trigger: the server routes are live; M Moser decides who may archive and restore.


## FD-42: Families: slides that belong together are told together (2026-10-26)

(FD-38 and FD-39 are Khushali's packs and archive; FD-40 and FD-41 are kept for Vince's renumbered decisions.)

Context and evidence: Asked for "the story of those three people", the storyboard told it with 16 of our 27 slides plus client slides that only matched on words. The slides that clearly belong together (same client, same template, made as one story) were treated as unrelated individuals, and Grant's point stands: M Moser has slides that belong together but no list of which. Reading every deck's theme showed most M Moser decks share one house template (Untitled Sans, accent FF893E), so look alone can't tell clients apart. Khushali (26 Oct) also asked that slides hidden in their source deck never go into a story.

Chosen outcome: The loader records each deck's template: its first theme's heading and body fonts, color scheme and main accent (null for a PDF). A family is slides with the same client, year and template; a PDF is its own family, and copies of one file count once. A family keeps its natural order: a deck's own order, or the number at the end of each file name when one story was stored as separate files. When one family holds most of the best matches for a request (at least 60% of the top 20, and at least 5), the story is told from that whole family in its own order, woven like a retold deck (FD-32), with nothing from outside; the page says "Told from the N slides that belong together: <family>." Otherwise the story is built as before. Slides hidden in their deck, never-show pages and copies naming another client are left out of every story. Result: the builders' story is all 27 of our slides, in the order we made them; nothing dropped in the regression check (3 of Grant's lead slides were hidden slides and are replaced).

Consequences: A family used as one chapter of a different story (Pursuit inside a law-firm pitch) is the next step. Families could suggest packs (FD-38) later. Archived decks are already left out of the database queries (Vince's FD-32, to be FD-40); the local library has no archive.

## FD-43: Talk to your story: each message continues it (2026-10-26)

Context and evidence: Demo review (Schiffon, 26 Oct): after a first story, telling it "these two slides were helpful, now look for this and that" reran the whole storyboard from scratch, losing the story on screen. It has to work like a conversation: react, refine, repeat until it's right.

Chosen outcome: The box under the story is a conversation ("Talk to your story"): the story's questions open it, and each message gets a short reply saying what was done. POST /storyboard/refine takes the story on screen as slide ids only (every slide is read again from the library), the slides marked Useful (never removed) and the message, and continues the story (services/story-refine.ts, rules only): "look for / find / add / what about X, Y and Z" searches each thing (home search's ranking, FD-33) and adds the best new slides to their own part of the story; "drop / remove / take out X" removes matching slides; "only keep the useful ones" trims to them; "more like these" adds slides from the same family (FD-42); "shorter" keeps one slide per moment plus Useful ones. A message that asks for none of these is more context: the story is rebuilt with it and the Useful slides are put back. Replies are honest: "Couldn't find anything new on pricing", "Nothing in the story was about résumés". Start over still starts over.

Found on the way: identical copies of a file share slide ids, so reading a list of slides counted each copy and could cut off the last slides asked for (two Moody's pages dropped out of a refined story). Each slide is now read once (fixture-smart-search fixtureRowsWhere), which also protects families, retelling and client context.

Consequences: The rules understand the common requests; the AI (once chosen) can read free-form requests the rules don't cover. Reordering by request ("put the team before the results") is not built yet.

```text
Decision ID and title: FD-51 Story data lives in M Moser's Supabase: story fields on slides, slide packs, free-form tags, and an import from the reviewed metadata
Status: proposed
Decision date: 2026-10-24
Decision owner/reviewer: Vincent (build), Schiffon (the metadata and the storyboard that reads it), Khushali (screens for tags and packs), Alina Pak (21 Oct check-in)
Context and evidence: The storyboard (FD-22 to FD-31) reads each slide's role, reuse status, themes and flags from files on one laptop (slide-metadata.json, discover-scan.json, deck-catalog.json), because the real decks can't leave it. Alina only sees what is in her Supabase. At the 21 Oct check-in Grant asked for slide packs and Alina for her categories plus free-form tags she can filter and sort by; her rule from 19 Oct is that AI labels only count once a person confirms them.
Options considered: (a) columns on slides and decks plus slide_packs and free_tags tables, filled by an import script that matches slides exactly; (b) one JSON column per slide holding whatever the files have; (c) keep the files and copy them to M Moser by hand.
Chosen outcome: (a). slides gains story_role, reuse_status, image_kind, themes, proof_sectors, projects, flags, shows, convinces, story_status (suggested or confirmed), story_confirmed_by and ai_uncertain; decks gains deck_kind, client_sector, project_location and outcome (won, lost or pending). New tables slide_packs and slide_pack_members (status suggested or confirmed, source import, upload or person) and free_tags (deck or slide, one copy of a tag per item, who added it). scripts/import-story-data.mts (npm run story:import) matches each slide by the storyboard's own id, which comes from the deck file's SHA-256 and the slide number, against decks.file_hash, so no names are guessed. Reviewed metadata is written as confirmed; the AI's reading alone stays suggested. Slide packs and deck kind, sector and location come from the reviewed CSV. Dry run unless --yes; one transaction; safe to run again (confirmed packs and people's tags are never replaced).
Consequences for scope, cost, security and integration: No AI calls and no slide text leaves the database. PDF decks aren't in Supabase, so their readings wait. Deck details from the SharePoint view (author, office, uploaded by, dates) are Khushali's and stay in their own block of schema.sql; project_location is where the client's project is, not the M Moser office. Meaning-based search (pgvector) is a separate step, because the extension has to be switched on in the project first.
Acceptance evidence / affected PR criteria: db:setup run twice on a local Postgres set up like M Moser's; the import's dry run, write and second write checked there (exact matches, confirmed vs suggested, one pack after two runs); typecheck.
Documents/contracts changed: server/sql/schema.sql, scripts/import-story-data.mts (new), package.json.
Revisit trigger: the storyboard reads from Supabase instead of the files; upload suggests these fields (FD-23); M Moser records which proposals won.
```

```text
Decision ID and title: FD-52 Packs, archive and deck details served by the server, to Khushali's contract (FD-38, FD-39)
Status: proposed
Decision date: 2026-10-26
Decision owner/reviewer: Vincent (build), Khushali (contract and screens), Schiffon (storyboard reads the same tables), Alina Pak (who may do what, at hand-off)
Context and evidence: Khushali's screens for packs (FD-38) and archive (FD-39) call routes that didn't exist yet and fall back to the browser. Her contract: a pack on every slide that is in one, POST/PATCH/DELETE /packs, confirm and unconfirm with who and when, dismissed suggestions kept, PATCH /decks/:id { archived }, archived=include|only on the library, and real Created by / Uploaded by details. While building it, the library listing turned out to return only the first 1,000 database slides, and the real library is now about 1,900.
Options considered: packs: (a) enforce the rules on the server in one transaction, (b) trust the screen; dismissing: (a) keep the row as "dismissed", (b) delete it (the import and the storyboard would suggest it again); deck details: (a) read the author and date PowerPoint records in docProps/core.xml, plus the signed-in uploader, (b) leave them empty until SharePoint.
Chosen outcome: (a) each time. server/packs.ts: 2 to 20 slides from one deck, each once, a slide in at most one live pack (409 naming the slide); a person's pack is confirmed by them; PATCH renames and confirms or unconfirms (confirmed_by, confirmed_at); DELETE dismisses a suggested or imported pack (dismissed_by, dismissed_at) and removes a person's own. Every slide in a pack carries the whole pack in order (search, smart search, slide page). PATCH /decks/:id sets archived_at and archived_by; search takes archived=include (marked provenance.archived, archivedBy, archivedAt) or only. Provenance carries createdBy, uploadedBy, createdAt, uploadedAt and location. Uploads record the uploader (X-SlideVault-User; upload:library --as "Name") and the file's author and date; scripts/deck-details.mts fills them in for decks already uploaded, matched by SHA-256. The story import replaces only its own unconfirmed suggestions and skips any pack that was dismissed or would share a slide with a live pack. Listing the library with no query returns every slide of every ready deck.
Consequences for scope, cost, security and integration: Anyone signed in can make, confirm, dismiss and archive for the MVP; who may is a tier decision for Alina, noted for hand-off. The signed-in name is still the prototype stand-in (principal.ts). "Created by" is whoever PowerPoint recorded as the file's author, which can be a template's author; it is shown as recorded. No AI calls, nothing deleted from storage.
Acceptance evidence / affected PR criteria: npm run test:packs (36 checks on a local Postgres: every rule above, the 1,000-slide cap gone, unknown details stay null); test:user-data and test:folder-path still pass; typecheck and lint on the changed files; the import checked to keep a dismissed pack dismissed.
Documents/contracts changed: server/sql/schema.sql, contracts/dto.ts (Provenance.archivedBy, archivedAt; ApiErrorCode CONFLICT), server/packs.ts (new), server/file-facts.ts (new), server/db.ts (transaction), server/pg-repository.ts, server/user-route.ts, server/services/upload.ts, app/api/slide-vault/v1/packs (new), decks/[deckId] (new), search, smart-search, slides/[slideId] and uploads routes, scripts/deck-details.mts (new), scripts/test-packs-archive.mts (new), scripts/import-story-data.mts, scripts/upload-library.mts, package.json.
Revisit trigger: Alina sets who may confirm, dismiss and archive; M Moser's login replaces the signed-in name; SharePoint supplies its own Created by.
```

```text
Decision ID and title: FD-53 Each slide's story tags and free-form tags reach the app; "internal - never show" slides stay out of search
Status: proposed
Decision date: 2026-10-26
Decision owner/reviewer: Vincent (build), Khushali (tags on the slide page and the tag filter), Schiffon (the reviewed tags), Alina Pak (21 Oct: "free-form tags I can filter and sort by")
Context and evidence: At the 21 Oct check-in the team agreed to show each slide's tags on its page, and Alina asked for her own free-form tags she can filter and sort by. The reviewed tags (FD-51) are in Supabase on 655 slides, but the app received none of them. 37 reviewed slides are marked "internal - never show".
Options considered: (a) a story object and a tags list on every SlideSummary, plus /tags routes; (b) a separate /slides/:id/tags call per slide (one request per card); (c) leave tags to the storyboard only.
Chosen outcome: (a). SlideSummary.story carries role, type, reuse, themes, sectors, projects, flags, shows, convinces, status (confirmed when the team reviewed it, suggested when only the AI read it) and uncertain. SlideSummary.tags lists the free-form tags on the slide and then its deck's. GET /tags lists every tag with how often it's used; POST /tags { on: 'slide' | 'deck', id, tag } adds one (adding it again returns the same tag, whatever the capitals); DELETE /tags/:id removes it; /search?tag= finds slides tagged themselves or through their deck. Slides marked "internal - never show" are left out of /search and /smart-search the same way hidden slides are (FD-50), and come back with hidden=include. client/api.ts has listTags, addTag, removeTag and slidesWithTag for the screens.
Consequences for scope, cost, security and integration: No AI calls. Anyone signed in can add or remove tags for the MVP; who may is a tier decision for Alina. Tags are stored with who added them, so a review or moderation step can come later. The storyboard still reads Schiffon's files until it switches to these tables.
Acceptance evidence / affected PR criteria: npm run test:tags (21 checks on a local Postgres); test:packs, test:user-data and test:smart-search still pass; typecheck and lint on the changed files.
Documents/contracts changed: contracts/dto.ts (SlideStory, FreeTag, SlideSummary.story and .tags), server/tags.ts (new), server/pg-repository.ts, search, smart-search and slides/[slideId] routes, app/api/slide-vault/v1/tags (new), client/api.ts, scripts/test-tags.mts (new), package.json.
Revisit trigger: Alina sets who may tag; people want to confirm or correct the story tags in the app; the storyboard reads from Supabase.
```

```text
Decision ID and title: FD-54 Upload preview without storing, tags saved with the upload, and author names shown tidied
Status: proposed
Decision date: 2026-10-28
Decision owner/reviewer: Vincent (build), Khushali (the one-page upload screen)
Context and evidence: Khushali's new upload page shows a deck's slides as cards so people can tag the deck and slides before pressing Upload, but had no pictures (grey boxes) and no way to send the tags with the upload. "File created by" showed names as PowerPoint recorded them, e.g. "ChelseaTerrell - M Moser Associates".
Options considered: preview: (a) render on the server into a temporary folder keyed by the file's SHA-256, reused by the upload, (b) render in the browser (no PowerPoint renderer there), (c) store first and preview after (uploads to M Moser's bucket are permanent). Names: (a) tidy when shown, keep what was recorded, (b) rewrite the stored value.
Chosen outcome: (a) and (a). POST /uploads/preview renders the slides with the same LibreOffice step as uploads into the server's temporary folder for two hours and returns { token, fileName, slideCount, alreadyUploadedAs, slides: [{ number, title, hiddenInSource, previewPath }] }; GET /uploads/preview/:token/:slide serves each picture. Nothing goes to the database or the bucket. If the same file is then uploaded, the upload reuses those pictures instead of rendering again. POST /uploads also takes deckTags (JSON list) and slideTags (JSON object of slide number to list), saved as free-form tags (FD-53) once the slides exist, by the signed-in person. "File created by" is shown tidied (drops " - M Moser Associates", splits a name typed without a space, but not McDonald or DeAndre); the stored value is unchanged.
Consequences for scope, cost, security and integration: A preview costs the same rendering time as an upload; the pictures sit only in the server's temporary folder and expire. The preview token is the file's fingerprint, so only someone who has the file can make one. No AI calls.
Acceptance evidence / affected PR criteria: npm run test:upload-preview (16 checks: real PNGs, reuse without a second render, bad tokens and paths, .pptx only, tags at upload, name tidying); earlier tests still pass.
Documents/contracts changed: contracts/dto.ts (UploadPreview, DeckSummary.tagsAdded), server/services/upload-preview.ts (new), server/services/upload.ts, server/tags.ts (addUploadTags, cleanTag), server/file-facts.ts (tidyPersonName), server/pg-repository.ts, app/api/slide-vault/v1/uploads (route and preview routes), client/api.ts (previewUpload, uploadDeck tags), scripts/test-upload-preview.mts (new), package.json.
Revisit trigger: uploads move to a background worker; M Moser's SharePoint supplies its own author field.
```

```text
Decision ID and title: FD-55 Meaning search with pgvector in M Moser's database, with any embedding model (free and local by default)
Status: proposed
Decision date: 2026-10-28
Decision owner/reviewer: Vincent (build), Schiffon (search and storyboard), Alina Pak (switched pgvector on, 27 Oct)
Context and evidence: The 21 Oct recap promised search by meaning: "a sustainability deck for a bank" should find the right slides even when those words aren't on them, using pgvector inside M Moser's Supabase so nothing leaves their database. Alina switched pgvector 0.8.2 on. M Moser can't share an OpenAI key for now, and Claude has no embedding model, so the fingerprints need a model that is free and can run locally; one team laptop can't run Ollama.
Options considered: (a) any OpenAI-style /embeddings endpoint, set by SV_EMBED_* like the AI reader (FD-17), free and local by default (Ollama with nomic-embed-text); (b) a model bundled into the app (heavy, slow to install); (c) OpenAI's embedding model (no key available).
Chosen outcome: (a). A slide_embeddings table (server/sql/vector.sql, set up by npm run db:vector, separate from db:setup) keeps one fingerprint per slide with the model that made it; the vector column has no fixed size, so changing model means running npm run embed:slides again, nothing else. embed:slides reads each slide's title, words and story tags (dry run first; skips unchanged slides). GET /meaning-search returns the closest slides with a similarity; smart search adds close-in-meaning slides after its keyword results when a search is submitted (so it never finds less than before), with "Close in meaning to your search". If no model is set, the model is down or pgvector can't be used, meaning search steps aside and keyword search works as before. The database connection's search path also names "extensions", where Supabase keeps pgvector; db:vector checks our role can use it and prints the one grant to ask for if not.
Consequences for scope, cost, security and integration: Free with a local model: slide text goes only to the model on the machine running SlideVault, searches send only the typed words. Whoever runs SlideVault needs the embedding model running (like the local AI reader). Hidden, internal-only and archived slides are left out as in other searches. At M Moser's size (about 1,900 slides) no vector index is needed.
Acceptance evidence / affected PR criteria: npm run test:meaning (14 checks on a local Postgres with pgvector and a stand-in model: setup twice, dry run, saving, skipping unchanged, "our people" finds "Meet the Team", archived left out, closest first, off when no model or the model is down); earlier tests still pass.
Documents/contracts changed: server/sql/vector.sql (new), server/embeddings.ts (new), server/meaning-search.ts (new), server/db.ts (search path), server/pg-repository.ts (getSlideSummariesPg), app/api/slide-vault/v1/meaning-search (new), smart-search route, scripts/db-vector.mts and scripts/embed-slides.mts (new), scripts/test-meaning-search.mts (new), env.example, package.json.
Revisit trigger: M Moser picks a hosted embedding model; the library grows past tens of thousands of slides (add an index); the storyboard uses meaning search too.
```
