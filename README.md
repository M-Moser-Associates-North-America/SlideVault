# SlideVault

SlideVault helps proposal teams find trusted slides, compare options, and assemble editable PowerPoint content while preserving the original material.

Build it as a complete standalone application with modular interfaces that allow potential future integration into an internal system. No target system or integration deployment is specified in this scope.

## Start here

**Status, 20 November 2026 (hand-off):** SlideVault is a working standalone application, handed over from `foundry-release` at `3b0cac0`. It covers the slide library and upload, search (by words, by meaning with pgvector, by what a slide looks like, with an optional AI reader), the Storyboard, saved slides and draft decks, and editable PowerPoint export of slides from one or several decks. It runs on M Moser's Supabase project through personal database logins, or on the synthetic decks in `tests/fixtures/` with no settings at all. Setup and every command: [docs/foundry/RUNNING.md](docs/foundry/RUNNING.md). Every choice, with its evidence and tests: [Decisions](docs/DECISIONS.md), FD-01 to FD-107. How well it works on the real library: [docs/foundry/EVALS.md](docs/foundry/EVALS.md). Accessibility: [docs/foundry/ACCESSIBILITY.md](docs/foundry/ACCESSIBILITY.md). Licenses of the packages it ships with: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Still to come from M Moser: your sign-in (replace `userOf()` in `features/slide-vault/server/principal.ts`), access rules, hosting, retention and an AI provider (D-02, D-07, D-08, D-12, D-13). The HTML in `reference/` is the original mockup, kept for comparison.

| Read | Purpose |
| --- | --- |
| [Product brief](docs/PRODUCT_BRIEF.md) | User needs, reference traceability, proposed phases, acceptance requirements |
| [Architecture](docs/ARCHITECTURE.md) | Standalone application structure and technology choices |
| [Portability contract](docs/INTEGRATION_CONTRACT.md) | Module interfaces, replaceable adapters and portability demonstration |
| [Design system](docs/DESIGN_SYSTEM.md) | SlideVault visual language and accessible UI behavior |
| [Design tokens](docs/design-tokens.css) | Shareable scoped light/dark token reference |
| [Data and API](docs/DATA_AND_API.md) | Entities, lifecycle, HTTP contract, job and export semantics |
| [Security and operations](docs/SECURITY_AND_OPERATIONS.md) | Access, content processing, environments, deployment and recovery |
| [Delivery plan](docs/DELIVERY_PLAN.md) | Milestones, evidence, acceptance and transfer checklist |
| [Decisions](docs/DECISIONS.md) | Confirmed constraints, recommended choices and kickoff questions |
| [Agent instructions](AGENTS.md) | Rules for AI coding agents working in this repository |

Read the product brief, architecture, portability contract, and agent instructions before implementing. The remaining documents are working references for the relevant task.

## Status and authority

- **Confirmed constraint:** explicitly requested by the product owner, including standalone development and provision for potential future integration.
- **Source requirement:** stated in the supplied proposal deck; proposed for the product, subject to release scope agreement.
- **Recommended baseline:** an implementation or sequencing choice prepared for kickoff. It is not a recorded approval by the owner.
- **Open decision:** has an owner and a milestone by which it must be resolved in [Decisions](docs/DECISIONS.md).

The recommended first release is the trusted slide library with editable PowerPoint export. Manual storyboards follow, then broader proposal assistance. This sequencing remains open for the owner to change. Dates, prices, suppliers, and procurement commitments have not been agreed.

Current owner instructions take precedence. For implementation, use the written contracts in this package, then the deck's product intent, then the HTML's interaction ideas. If those conflict, record the discrepancy and follow the documented resolution. Update the relevant documents and decision log together when scope changes.

## Supplied references

- [Approximate HTML mockup](reference/SlideVault.html)
- [Proposal-team presentation](reference/SlideVault_Presentation1_Aug5.pptx)

Treat these as reference artifacts. The HTML demonstrates screens and navigation; its login, upload, sharing, and export demonstrations are not production implementations. The presentation establishes trust, reuse, curation, and human editorial control as product goals.

## What the team delivered

A runnable standalone application (Next.js 16, React 19, TypeScript), its API under `/api/slide-vault/v1`, database setup for M Moser's Supabase project (`npm run db:setup`, adds only), placeholder-only `env.example`, synthetic fixture decks, automated tests and CI (typecheck, lint, export checks, build and browser accessibility tests on every pull request), an operating guide, and the decision log. The feature can run standalone or mount inside another page (`SlideVaultWorkspace` from `features/slide-vault/index.ts`, contract in `features/slide-vault/contracts/runtime.ts`).

Quick start:

```bash
npm ci
npm run ingest   # read the sample decks
npm run dev      # open http://localhost:3000/slide-vault
```

Needs Node.js 22 or newer, LibreOffice and poppler. Database, AI and meaning-search settings, the library upload, the look import and the support jobs are in [docs/foundry/RUNNING.md](docs/foundry/RUNNING.md). Any future integration into another system will be scoped separately.
