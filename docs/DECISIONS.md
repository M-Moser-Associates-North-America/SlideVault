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
