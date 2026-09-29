# SlideVault product brief

Status: proposed delivery baseline. The source material establishes product needs; the phased scope below is a recommendation for agreement, not an approved estimate or commitment to deliver every mockup screen.

## Purpose and intended outcome

SlideVault helps proposal teams find trustworthy presentation content, judge whether it fits an opportunity, and assemble editable material for further work. It should reduce time spent searching, checking versions, and recreating existing slides so the team can spend more time on the proposal's story and visual quality.

Build SlideVault as a standalone application that can be run and demonstrated using this repository, synthetic fixtures, and an isolated development environment. It may later integrate with an internal system. Keep documented interfaces and adapters for identity, navigation, data access, and project references so a future integration can reuse the application without a major rewrite.

SlideVault supports the proposal team's judgment. People decide the pursuit strategy, choose appropriate evidence, adapt material, validate claims, approve reusable content, and approve final submissions. A relevant search result is not proof that a slide is current, approved, or suitable for another client.

## Source material and how to use it

- [Project presentation](../reference/SlideVault_Presentation1_Aug5.pptx): 18 slides describing the workflow, pain points, success requirements, and an ideal future tool. Slide numbers below refer to the physical slide order, including divider and blank slides.
- [HTML mockup](../reference/SlideVault.html): approximate interaction and visual reference. View labels below identify the relevant screen; the exported HTML may contain an embedded application payload.

The presentation is the stronger source for product outcomes and editable export. The HTML illustrates possible navigation and workflows, including a broader storyboard concept. Neither is a production implementation or an exhaustive specification. Where they conflict, use the resolution recorded below; unresolved decisions require a documented decision before the affected feature is committed.

Reference assets have not been approved as public sample data. Use synthetic client names, people, projects, source links, and presentation content in implementation fixtures, screenshots, tests, and demonstrations. Do not copy private examples from the references into these artifacts.

## Users and responsibilities

| Persona | Main job | SlideVault should provide |
| --- | --- | --- |
| Proposal specialist | Turn pursuit strategy and multidisciplinary input into a coherent response | Fast discovery, previews, comparison, trustworthy metadata, ordered selection, editable export; later, a manual storyboard |
| Content curator or content owner | Keep reusable material current and approved | Review queues, content classification, approval and retirement controls, version relationships, provenance |
| Contributor or subject-matter expert | Supply or update a specific piece of content | Controlled ingestion and metadata; later, visibility of assigned storyboard items |
| Pursuit lead or reviewer | Confirm strategy and review quality | Clear content context and provenance; later, review of the response structure and gaps |
| Application administrator or integrator | Operate SlideVault and support future integrations | Explicit access rules, observable jobs, documented configuration, portable data, integration contracts |

These are product responsibilities. They do not require five distinct authorization roles. The architecture and access-control specification should map capabilities to the smallest workable role model.

## Terminology

| Term | Meaning |
| --- | --- |
| Deck | A source presentation and its metadata. The source file remains intact. |
| Deck version | An immutable revision of a source deck. Reimporting a changed file must not silently replace the source behind an existing selection. |
| Slide | One slide in a specific deck version, with its source position, preview, extracted content, and metadata. This is the primary discovery and reuse unit. |
| Page | A label used in the mockup. In the library it means a source slide; in a storyboard it means planned output length. Keep those meanings explicit in the UI and data model. |
| Content class | Whether material is canonical, reusable, or one-off. This is separate from its file format, document category, and approval status. |
| Canonical item | An approved source of truth for a defined subject and variant, with an identified current version. |
| Selection | An ordered set of source slides chosen for export. It is not yet a finished proposal or a storyboard. |
| Storyboard | A response plan organized into sections and tiles. It can refer to existing slides and describe content that still needs to be created. |
| Tile | A planned content need with a title, notes, optional assignee, page allocation, and attached references. One tile may represent more than one output page. |
| Export | A new output file assembled from selected content. It must preserve the original source and record which source versions were used. |
| Project reference | A stable reference to an external opportunity/project plus the minimum display information needed by SlideVault. The project provider remains the authority for that record. |

Use `slide` in implementation contracts for library items. Whether the user-facing navigation retains `Pages` or changes to `Slides` remains a design decision; do not create different entities merely because the reference uses both words.

## Three content classes

| Class | Examples | Tool responsibility | Human responsibility |
| --- | --- | --- | --- |
| Canonical | Company overview, services, capabilities, approved biographies | Retrieve and clearly identify the current approved source; show approved variants and any replacement | Confirm relevance and placement; curate and approve changes |
| Reusable | Strong diagrams, experience slides, precedent submissions | Surface useful options with source context, quality and reuse restrictions | Evaluate, select, adapt, and contextualize |
| One-off | Client-specific themes, custom narrative, bespoke diagrams | Keep the work distinct from approved library content; support discovery and assembly | Create the client-specific story; decide whether any part merits later promotion |

Newly ingested material must not become canonical merely because it was uploaded, frequently selected, or generated by a model. Promotion is a review action. A completed proposal is not automatically an approved reusable deck.

The presentation proposes one or two canonical versions at most. Recommended interpretation: one current approved version for each explicitly defined variant; a second variant must have a recorded purpose, such as audience or language. Historical versions can remain for provenance without appearing as competing current defaults. The owner must confirm the variant policy before canonical governance is signed off.

## Core journey

1. **Contribute:** an authorized user uploads an approved test/source presentation. The tool retains the original privately and reports ingestion progress or an actionable failure.
2. **Find:** a proposal specialist searches at slide level or browses decks, then narrows results by useful attributes and content class.
3. **Trust:** each candidate exposes its preview, source deck/version/slide number, owner, approval state, review date, and reuse restrictions. Missing metadata is shown as unknown, not treated as approval.
4. **Compare:** the user inspects several candidates together, including their source and approval context, before selecting one or more.
5. **Assemble:** the user adds slides to a persistent selection, changes their order, removes items, and checks any blocked or obsolete items.
6. **Export:** the tool produces a real editable PowerPoint file in the requested order, preserves the original sources, and makes failures or unsupported content visible.
7. **Improve:** curators correct metadata, approve replacements, retire obsolete content, and review promising new material for reuse.

The later storyboard journey adds a response plan before assembly: choose a project reference, define sections and tiles, allocate a page budget, assign contributors, attach selected library slides or private supporting files, and review gaps. Planning and content selection remain separate so an empty tile can represent work still to be created.

## Recommended phased scope

The choice between a library-first release and a broader initial proposal workflow is still a product-owner decision. This sequence concentrates the first release on the strongest requirements in the presentation and addresses editable export early, because that capability affects the ingestion and storage design.

### Phase 1 — Trusted slide library

Deliver an end-to-end path from private source ingestion to ordered editable export:

- Private PPTX ingestion, preserved source versions, extracted slide records and useful previews, durable processing status, and retryable failures.
- Deck and slide browsing; keyword search and metadata filters; visible distinctions between the three content classes.
- Slide detail, source attribution, approval and review information, and side-by-side comparison.
- Curator workflows to classify, review, approve, supersede, and retire content; a clear current canonical version.
- A persistent ordered selection with real editable PPTX output and export provenance.
- Authentication and authorization applied to metadata, thumbnails, original files, search results, selections, and exports. Private file access must be checked again when an export runs.
- Synthetic data and local/test adapters so the team can demonstrate the full flow in an isolated environment.

PPTX is the recommended first reusable source format. PDF can be considered as a later preview/reference input, with an explicit label that it does not contain editable PowerPoint objects. PDF ingestion must not be advertised as fulfilling the editable export requirement by flattening pages into images.

### Phase 2 — Manual proposal storyboards

Extend the verified library with the planning workflow demonstrated by the HTML:

- Create a storyboard using a project adapter that initially returns synthetic projects.
- Define sections, ordered tiles, notes, a total page target, per-tile page allocations, an owner, and contributor assignments.
- Attach references from the library and private local files without promoting those attachments into the reusable library.
- Persist edits and show understandable completion/gap states. Report planned pages separately from attached slide count; neither alone establishes readiness for submission.
- Review and assemble storyboard content using the export capability proven in Phase 1. Specify what happens to unfilled tiles and multi-page tiles before promising storyboard export.

Real-time co-editing, notifications, and external sharing are separate decisions. A team assignment in the mockup does not imply that these services already exist or are included.

### Phase 3 — Assisted workflow and content-system integration

Consider these after users validate the library and storyboard flow:

- RFP extraction of requirements, deadlines, criteria, attachments, and potential gaps, with source evidence and explicit human validation.
- Semantic search, opportunity-aware recommendations, suggested tags, possible duplicates, and proposals to promote reusable content.
- Checks for completeness, repetition, inconsistent terminology, and potentially outdated claims. Findings are review aids, not an automatic compliance certification.
- An approved SharePoint connector with defined locations, access propagation, incremental updates, deletion/revocation behavior, and operational ownership.
- Archiving and curation suggestions informed by use and review history. Popularity alone must not determine authority or quality.

Provider, model, evaluation data, cost limits, and production connector access are not selected by this brief. Mocked adapters should keep these additions possible without making them a prerequisite for Phase 1.

## Source traceability and discrepancies

| Requirement or idea | Presentation | HTML view / behavior | Direction |
| --- | --- | --- | --- |
| Faster discovery and useful previews | Slides 14, 15, 17 | `Home`, `Library`, `Pages`, deck detail, slide detail | Phase 1; discovery at slide level as well as deck level |
| Search and filtering | Slides 14, 17 | `Library` categories; `Pages` intent filters and search | Phase 1; search must work on stored, authorized data |
| Compare several candidates | Slides 14, 17 | Previews and multi-selection exist; a dedicated comparison flow is not established | Phase 1 requirement; design a clear comparison interaction |
| Three content classes | Slides 9, 11, 17 | Categories and intent labels do not implement this distinction | Add explicit content class independent of document category |
| Canonical current version and curation | Slides 14–17 | `Library` / detail editing; no complete approval or retirement workflow | Phase 1 requirement, including approval history and current-version rules |
| Source, owner, review date, confidentiality | Slides 14, 15, 17 | Deck/slide detail and source-deck link show partial context | Complete the trust metadata and authorization behavior |
| Editable output and untouched sources | Slides 14, 17 | `Pages` selection tray calls a PDF export message; slide detail offers image export; storyboard has PDF action | Editable PPTX is the acceptance target; PDF/image output alone does not meet it |
| Ordered selection | Slides 11, 17 support assembly | `Pages` selection tray has reorder and remove actions | Phase 1; retain order across save/reload and actual export |
| Private ingestion and processing | Slide 15 describes protection; slides 14, 17 describe reuse/curation | `Upload`, `Upload queue`, duplicate dialog | Build real ingestion; mockup progress and duplicate example are illustrative |
| Storyline and page planning | Slides 11, 12 | `Create`, `Library` → `Storyboards`, storyboard detail | Recommended Phase 2; manual planning before automated narrative generation |
| Project linking and team assignment | Slides 4, 7, 11 describe coordination | `Create` project/details/team/review steps; storyboard tile assignees | Phase 2 using a project/people adapter with synthetic fixtures |
| RFP assistance and quality checks | Slide 11 | AI language and insight panels suggest assistance without an evaluated service | Phase 3; people validate findings |
| SharePoint discovery and archiving | Slides 5, 7, 17 | `Import from SharePoint`, source-deck link | Phase 3 connector; no live integration is supplied |
| Recently approved / frequently used content | Slides 17, 18 | `Home` trending cards | Later ranking/curation work; mockup ranking is not evidence of actual usage |

The source presentation describes the process with differing step counts on slides 7, 11, and 12. Preserve the responsibilities and user journey, not a hard-coded number of workflow stages.

### What the HTML does not establish

The mockup is an interaction reference with local/in-memory state. These observed behaviors must not be mistaken for completed functionality:

- **Authentication:** `Sign in` changes an in-memory authenticated flag. It does not establish a verified identity or enforce server access rules.
- **Save and export:** the selection save action, PDF export actions, and storyboard share action display messages. They do not demonstrate durable persistence, generated files, or a functioning share link.
- **Upload:** the main browse/drop flow stages a fixed six-page example; starting upload adds an in-memory queue item. This is not file parsing, private storage, or a processing worker.
- **SharePoint:** the import action stages an example and the source link points to a generic site. This is not authenticated discovery, source-item provenance, or access synchronization.
- **Storyboard attachments:** local files can be read into browser memory for preview. This does not provide durable storage, server validation, permission inheritance, or later retrieval.
- **AI and duplicate detection:** sample summaries, ranking, fixed progress, and a sample duplicate dialog do not demonstrate a search/recommendation model or a duplicate-detection service.

## Product acceptance criteria

These IDs are intended for backlog items, demonstrations, and handoff evidence. They describe the proposed scope; do not label a criterion passed solely because a matching button or success toast is present.

| ID | Phase | Observable acceptance |
| --- | --- | --- |
| PR-01 | 1 | Using synthetic PPTX fixtures, an authorized contributor can ingest a deck, see a durable processing state, and browse the resulting slides after a reload. Invalid files and processing failures produce actionable errors without publishing incomplete content as ready. |
| PR-02 | 1 | A proposal specialist can search at slide and deck level and combine documented metadata filters. Results, counts, suggestions, and previews exclude content the user cannot access. Empty and failed searches have distinct states. |
| PR-03 | 1 | A slide's preview and detail identify the source deck/version/position, content class, owner, approval status, review date, and restrictions. Unknown values are explicit. Source retrieval is authorized. |
| PR-04 | 1 | A user can compare at least two candidate slides with legible previews and their trust metadata, then add/remove candidates without losing the search context. |
| PR-05 | 1 | Only authorized curators can approve, supersede, or retire reusable/canonical items. Current canonical variants are unambiguous; previous versions retain provenance; approval actions are attributable. Retired or restricted items cannot silently enter an export. |
| PR-06 | 1 | A user can save an ordered selection, reload it, reorder/remove items, and see source versions plus any newly unavailable items. Another user cannot retrieve the selection unless explicitly allowed. |
| PR-07 | 1 | Exporting an agreed representative PPTX fixture set produces a real `.pptx` in selection order. Text and supported native elements remain editable in PowerPoint; required visual fidelity is reviewed; original source bytes remain unchanged. Unsupported elements cause a clear result according to the agreed support matrix, never an undisclosed image-only substitution. |
| PR-08 | 1 | Export jobs report progress, completion, and failure accurately and record the source version/slide mapping. Authorization or approval changes are enforced at job execution and at authenticated download initiation or temporary-grant issuance. Previously issued grants follow the explicitly agreed expiry/revocation policy in D-08; immediate revocation requires a delivery mechanism that supports it. |
| PR-09 | 1 | Attempts to access another user's or restricted content through search, direct object/file URLs, previews, exports, and stored selections are denied by the server. A UI-hidden button is not the security boundary. |
| PR-10 | 1 | The documented setup and an end-to-end ingestion/search/selection/export demonstration work from this repository with synthetic content and isolated configuration. Portability interfaces are documented and have local/test adapters. |
| PR-11 | 2 | A user can create and reopen a storyboard with sections, ordered tiles, notes, assignments, per-tile allocations, and a total page target. The planned-page sum and over-budget state reflect edits accurately. |
| PR-12 | 2 | A tile can reference selected library slides and private supporting files, with provenance and permissions preserved. Attachments do not automatically become approved reusable content; unresolved tiles remain visible. |
| PR-13 | 2 | A storyboard can store a stable external project reference through the documented adapter. A missing or unavailable project/people service has a useful state, and existing storyboard content remains recoverable independently of that service. |
| PR-14 | 3 | Any AI-extracted requirement or recommended action exposes supporting evidence and can be accepted, edited, or rejected by a person. The system does not automatically approve library content or a final submission. Connector and AI acceptance additionally require a scoped specification before implementation. |

The PPTX support matrix and reference fixtures are a Phase 1 discovery deliverable. It must cover representative layouts and masters, fonts, images, text, tables/charts, aspect ratios, and any embedded content the owner needs to preserve. A basic file-opening test is insufficient proof of editability or visual fidelity.

## Proposed success measures

The presentation suggests measures but supplies no baseline or targets. Establish these during a pilot with a fixed, permitted corpus and representative tasks; agree targets before interpreting the results as launch criteria.

| Measure | Proposed definition | Why it matters |
| --- | --- | --- |
| Time to suitable content | Median and upper-quartile elapsed time from a task prompt to a user-confirmed suitable selection, compared with the current process | Tests whether discovery improves the actual job |
| Search usefulness | User-rated relevant results within the first ten authorized results for a fixed evaluation set | Separates retrieval quality from raw result volume |
| Canonical trust coverage | Share of active canonical items with an owner, approval, review date, and unambiguous current variant; report overdue reviews separately | Makes curation gaps visible |
| Usable editable exports | Share of representative export attempts that complete and pass the agreed editability/fidelity review | Measures the promised output, not just job completion |
| Reuse and curation | Existing slides selected for real tasks and newly approved reusable items, with deduplication and a defined reporting period | Tracks value without rewarding uploads alone |

Collect only the event data needed for these measures. Do not place confidential slide text, client data, original files, or prompts into general analytics events.

## Outside the proposed initial release

These items are not commitments inferred from the references:

- A browser-based replacement for PowerPoint or automatic redesign of arbitrary slides.
- Autonomous pursuit strategy, final storytelling, claims approval, compliance certification, or proposal submission.
- A full opportunity CRM, project-management system, or company-wide user/project administration.
- Live SharePoint synchronization or unrestricted access to company content stores.
- Real-time co-editing, email/notification services, or public/external share links.
- Automatic promotion or deletion based on popularity, age, or model recommendations.
- Universal conversion of PDF or unsupported presentation objects into editable native PowerPoint content.

## Decisions still required

| Decision | Recommended working assumption | Resolve by |
| --- | --- | --- |
| First release boundary | Phase 1 library first; storyboard is the next increment | Scope/budget agreement |
| Authoritative output and supported source formats | Editable PPTX first; optional PDF is a separate output/reference capability | Ingestion/export discovery gate |
| Canonical variants and review ownership | One approved current version per documented variant; named curator responsibilities | Governance design sign-off |
| Initial permitted content and test fixtures | Synthetic data for the external team; separately approved realistic fixtures for fidelity evaluation | Before accepting or sharing any real corpus |
| Confidentiality and reuse policy | Explicit capability checks and visible restrictions; no implicit company-wide permission | Access-model sign-off |
| Corpus size, upload limits, job time, and search targets | No numerical promises until the representative corpus and deployment are agreed | Technical discovery |
| Storyboard completion and export semantics | Planned pages, attachments, and reviewer readiness are separate concepts | Before Phase 2 commitment |
| Production identity, storage, model/provider, and content connectors | Isolated adapters during development; provider choices recorded separately | Before production deployment |

Keep this brief, the acceptance backlog, and the implementation plan consistent when a decision changes. Reference screens may inspire an interaction; only documented, agreed scope defines the delivery obligation.
