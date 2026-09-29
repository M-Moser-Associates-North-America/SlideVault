# Security and operations

**Status:** recommended requirements for the isolated build and handoff. Provider, region, retention and production owners remain open in [Decisions](DECISIONS.md). The supplied deck explicitly requires permissions and confidentiality to carry through discovery, preview, export and reuse.

## Development boundary

Use a dedicated SlideVault development environment, synthetic documents and synthetic identities. A product owner may later supply a specifically approved evaluation corpus through an agreed channel. Access to the repository does not authorize use of client material with external services.

Keep the repository private according to the owner's sharing decision. This package does not grant rights to redistribute fonts, third-party conversion engines, brand assets or reference content. Inventory dependencies and asset licenses, and provide replacement/fallback behavior when an asset is unavailable.

## Authorization policy

Authenticate the request, require an active account, then check action and resource scope. Apply the same policy to source files, extracted text, thumbnails, search/facet counts, related results, collections, jobs, exports and downloads. Fail closed on missing/stale policy. A contributor cannot publish by editing a metadata field.

The following is a **proposed SlideVault pilot role template** for Gate 0:

| Pilot role | Proposed actions |
| --- | --- |
| Reader | Search/preview approved content in assigned libraries; create own collections; export only where explicit reuse/export permission permits |
| Contributor | Reader actions plus upload and edit own drafts; submit for review |
| Curator | Review, approve, edit taxonomy and retire content within assigned libraries |
| Library administrator | Manage library access, source deletion and operational recovery within that library |

Maintain separation between curation and infrastructure administration. Owning an upload does not allow the uploader to widen restrictions inherited from its source. Collection access cannot widen attached-source permissions. Until sharing is approved, collections/exports are private to their creator, with explicitly authorized operational access.

In a Supabase implementation, use private buckets and appropriate object policies. Privileged service credentials bypass storage RLS, so server/worker authorization must still check the initiating user's resource rights. Never expose those keys in the browser. See [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

Tables exposed through the Data API require deliberate grants and RLS policies; server database connections may bypass those policies. Keep the feature schema private by default and test both application and direct data/storage paths. Use trusted server membership, not user-editable metadata, to determine access. See [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

Signed URLs are bearer grants until expiry. Propose a maximum five-minute media/download grant for the pilot, then confirm at Gate 0 and resolve D-08 before Gate 3 acceptance. If immediate revocation is required, use authenticated streaming or a revocable delivery layer. Recheck permission before issuing each grant. Previously issued grants follow the agreed expiry/revocation policy. Do not claim already-downloaded files or screenshots can be recalled.

## File and processing security

- Verify file signature, actual bytes and declared type. Enforce file-size, page-count, archive-entry, decompressed-size, CPU, memory and processing-time limits before and during conversion.
- Reject encrypted/unsupported/macro-enabled content unless deliberately added to the support matrix. Never execute macros, scripts, OLE objects or embedded executables.
- Quarantine uploads until validation succeeds. Run conversion in a constrained worker with limited filesystem access, bounded temporary storage and controlled network egress. Inspect dependencies and scan files as required by the agreed deployment policy.
- Do not fetch embedded document URLs automatically. Future URL imports require allowlisted sources, private-address/redirect protections and restricted credential forwarding.
- Render previews as controlled image assets. Escape extracted text and sanitize allowed rich content; do not inject imported HTML or SVG into the application.
- Enforce authorization for exact source versions at queueing, worker execution and delivery. Authenticate worker callbacks or keep completion inside the private queue/database boundary.
- Rate-limit ingest, search and export by principal/library; set concurrency and storage quotas. Return actionable safe errors without leaking files or object paths.

## AI and search processing

AI is optional beyond the agreed first-phase search. Establish provider, data region, retention, permitted document classes and budget before sending content to a model or embedding service. Keep a deterministic text/metadata search fallback.

Documents and RFPs are untrusted input. Models may suggest tags, summaries or matches; they may not approve content, expand access, execute commands or submit proposals. Preserve human review and visible provenance. Use structured validated outputs, bounded requests and provider adapters. Disable payload tracing/logging by default. Do not put document content into exception trackers.

Store model/prompt/schema versions with suggestions so they can be reviewed, replaced or deleted. Propagate content deletion and permission changes to derived text and vector indexes. Do not use popularity to override approval, confidentiality or relevance.

## Future SharePoint connector

Gate 0 should decide whether manual upload with recorded provenance is sufficient for the first release. SharePoint integration requires an isolated test tenant or explicitly approved test library, never a blanket production tenant grant.

If selected, prototype the least-privilege resource grant, source version/change tracking, content deletion and effective user access before ingestion at scale. Microsoft Graph Selected permissions require both consent and explicit resource assignment; this is a connector authorization mechanism, not a complete end-user content-access model. See [Microsoft Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).

An application being able to fetch a document does not mean every SlideVault user may see it. Define how source permissions intersect with library and reuse policy. On unknown or stale source permission state, withhold content until reconciled. Record reconciliation freshness and verify revocation, renamed/moved files, deleted files and reconnect behavior. Do not overwrite the source or write back to SharePoint in the initial read-only connector.

## Environments and configuration

`env.example` must eventually document every variable, type, purpose, required/optional status, browser exposure and owning service. It does not exist yet because providers have not been selected. Supply placeholders, validation and setup instructions with the scaffold.

| Environment | Required isolation |
| --- | --- |
| Local/development | Synthetic fixtures, separate database/storage and limited provider credentials |
| Dedicated staging | Test identities and approved test corpus, private access, staging-only secrets |
| Production | Separately provisioned owner-controlled resources, reviewed migrations and least-privilege identities |

Keep local environment files gitignored and complete for the selected development resources. Use deployment-scoped secrets for hosted environments. Validate the target environment/resource identity at startup and before migrations, and fail explicitly on missing configuration. Worker configuration must follow the same isolation and validation as the web service.

Only intentionally public configuration may use `NEXT_PUBLIC_`. Give preview deployments synthetic or appropriately isolated environments with limited credentials. Never expose production or broad staging credentials to untrusted preview code. Document the selected hosting provider's environment and secret-scoping configuration with the scaffold.

Proposed configuration categories are database connections, private storage, auth adapter, queue/worker identity, converter location/license, upload limits, grant expiry, retention, optional search/AI provider and telemetry. Final names belong in the implemented schema and placeholder file; do not invent working credentials or URLs.

## Required operating runbooks

The team must deliver tested procedures with the release:

| Procedure | Evidence to include |
| --- | --- |
| Bootstrap | Fresh checkout, dependency install, local backend, migrations, synthetic seed, web and worker startup |
| Deploy | Web/worker compatibility, configuration validation, migration sequence, health checks and smoke test |
| Failure/retry | Locate failed job by request ID, classify safe error, retry without duplicates, recover expired leases |
| Restore | Restore database and required object versions to an isolated environment; verify hashes and references |
| Upgrade/rollback | Additive migrations first, prior worker/web compatibility, queue drain/pause, backup restore where downgrade is unsafe |
| Reindex | Rebuild text/optional vector/preview outputs by source version without changing human approvals |
| Revoke/delete | Disable access, invalidate delivery and jobs, remove derived assets, verify purge and retained audit policy |
| Provider outage | Stop/retry affected stages, preserve source and collection state, show honest user status |
| Transfer | Export approved content and manifests, map identities, import/reconcile, revoke team credentials after handoff |

Define retention separately for originals, previews/text/indexes, temporary uploads, generated exports, audit events and backups. No indefinite default. Owner sets deletion deadlines and backup expiry before a real-data pilot. Physical purge cannot promise removal from recipients' downloads.

Monitor queue age, worker heartbeat, ingest/export latency, failure/retry rate, storage growth, converter saturation and optional AI costs. Logs use request/job IDs and operational metadata. Avoid raw search text, client names, document content, tokens and grants. Document alert thresholds, an accountable operator, backup frequency, recovery targets and cost limits at Gate 0; this handoff does not create an on-call or service-level commitment.
