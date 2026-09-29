# SlideVault

SlideVault helps proposal teams find trusted slides, compare options, and assemble editable PowerPoint content while preserving the original material.

Build it as a complete standalone application with modular interfaces that allow potential future integration into an internal system. No target system or integration deployment is specified in this scope.

## Start here

This is a documentation and reference repository as of **29 September 2026**. There is no application, package manifest, backend, or executable test suite yet. The HTML is an interactive mockup with simulated behavior. The documents below describe the intended implementation, not working features.

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

## First delivery from the team

Produce the Gate 0 scope and technical evidence described in the [delivery plan](docs/DELIVERY_PLAN.md), particularly editable PowerPoint fidelity and the embeddable feature boundary. Then add a runnable standalone harness, setup commands, a complete placeholder-only `env.example`, synthetic fixtures, and CI. Replace this repository-status paragraph only when those files and commands actually exist.

The team delivers a working standalone application, source, migrations, worker packaging, tests, operating instructions, and a portability demonstration. Any future integration into another system will be scoped separately. Repository publication and deployment are separate from preparing this handoff.
