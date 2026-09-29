# Portability contract

**Status:** proposed v0.1 contract, 29 September 2026. These interfaces define SlideVault's own runtime boundaries. Publish and test the final types during implementation. A future embedding destination has not been specified.

## Runtime responsibilities

| Boundary | Feature responsibility | Replaceable runtime responsibility |
| --- | --- | --- |
| Workspace | SlideVault UI, domain logic, contracts and scoped styles | Mount point and application layout |
| Identity | Consume verified identity through the server seam | Session validation and active-account checks |
| Access | Enforce action and resource authorization | Resolve SlideVault capabilities and current library memberships |
| Navigation | Feature route/state model | Base path, deep links and browser history |
| Data | Feature-owned schema, migrations and data transfer tools | Database/storage implementation and environment configuration |
| Processing | Worker package, queue contract, renderer/export contract, runbook | Job infrastructure and approved provider credentials |
| Project context | Optional opaque project reference | Authorized lookup adapter, when the product requires one |

The standalone SlideVault application supplies working implementations of every required runtime boundary. The delivery includes a generic test container that exercises alternative adapters. This establishes portability without defining another application's architecture.

## Browser entry point

Deliver an importable `SlideVaultWorkspace` from `features/slide-vault/index.ts`. It renders content in the space allocated by its parent. It owns local tabs, search, collection tray, dialogs and editors. The application container owns login, top-level navigation, page layout, theme choice, routing and session refresh.

The following is a **contract sketch**, not a drop-in implementation. Publish compilable, versioned types during Gate 1; align the endpoint DTOs with [Data and API](DATA_AND_API.md).

```ts
type Capability =
  | 'library.read' | 'source.upload' | 'source.download' | 'metadata.edit'
  | 'content.review' | 'content.retire' | 'source.delete'
  | 'collection.write' | 'export.create' | 'library.manage';

type Location = {
  view: 'home' | 'library' | 'pages' | 'upload' | 'deck' | 'slide';
  id?: string;
  query?: string;
}; // Add storyboard routes only when that phase is selected.

interface SlideVaultRuntime {
  contractVersion: '0.1';
  sessionScopeKey: string; // Opaque value changed on identity/access-scope changes
  capabilities: ReadonlySet<Capability>;
  theme: 'light' | 'dark';
  location: Location;
  navigate(next: Location, options?: { replace?: boolean }): void;
  request(input: {
    path: string; // Relative to the configured SlideVault API v1 root
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown; // JSON only; binary uploads use a separate typed method
    headers?: Record<string, string>; // e.g. If-Match / Idempotency-Key
    signal?: AbortSignal;
  }): Promise<Response>;
  onSessionExpired(): void;
  requestFullscreen?: (enabled: boolean) => void;
  projectContext?: { id: string; label: string };
}

interface SlideVaultWorkspaceProps { runtime: SlideVaultRuntime }
```

Implement the runtime bridge in a Client Component. Functions, sets and adapter instances cannot be passed as ordinary serialized props from a Server Component. Pass only serializable initial data across that boundary, then construct the bridge on the client.

`request` adds authentication and the configured API root outside the feature. It accepts only relative feature paths, rejects absolute URLs and path traversal, and does not forward credentials to a signed storage URL. A separate upload method may PUT binary content to a scoped upload grant. Neither API secrets nor raw session credentials enter feature state, local storage, analytics, or public component props.

A 401 requests runtime session handling once; avoid refresh loops. A 403 remains a permission failure. On sign-out, identity change or authorization-scope change, clear feature query caches, selections and private previews. The runtime changes `sessionScopeKey` for those events and the feature resets or remounts its state; use an opaque revision, never a token or a trusted permission claim. Capabilities may change during a session. They never replace server enforcement.

Search/filter/order/selection state must survive normal feature navigation. Use the runtime bridge for deep links and browser back/forward. Persist durable collections on the server. Keep sensitive search text out of shared URLs and analytics by default; explicitly define any URL persistence in the UX contract.

## Server seam

Route handlers use adapters for authenticated identity, action/resource authorization, storage, repositories, jobs and optional search/AI. Keep these interfaces in the server entry point. No client barrel may re-export server code.

The authentication and authorization adapters return a **verified server principal** with a stable subject and authorized library memberships. The domain layer then checks action and object scope. A body field such as `userId`, `libraryId` or `projectId` is never proof of authority. The job runner reloads current access and content state for the initiating principal.

Define an explicit mapping between the selected identity/access implementation and SlideVault capabilities. Publish and test that mapping before production. A read grant does not imply download, export, publishing, or access to every document. Changing the identity provider must preserve these authorization semantics.

Default transport is same-origin HTTP under `/api/slide-vault/v1`. Authentication mechanics remain replaceable. Do not make the feature depend on a particular cookie name, bearer issuer, login provider, or browser authentication SDK. Cross-origin services require an explicit service identity/CORS design; never forward a user token to an unrelated service.

## Independence requirements

- No undocumented application imports, hardcoded production URLs, global `window` integration hooks or iframe dependency.
- Keep one React runtime. Use relative feature imports or a feature-specific alias whose mapping can move with the module.
- CSS is namespaced and portals retain the token scope. The feature fits a parent container, including sidebar and fullscreen layouts, without taking over `body` scrolling unconditionally.
- Local auth, fake project choices and development identities live in the application container/test adapter. Development bypasses fail closed in shared or production environments.
- External project/directory IDs are opaque references resolved through explicit adapters. A project association grants no library access automatically.
- Dependencies, fonts, binaries and renderer licenses must permit the intended delivery. Supply an inventory before choosing a production conversion engine.

## Portability demonstration

Gate 4 must demonstrate all of the following in a generic test container. This container is a verification fixture, not a replica of another application:

1. Mount the unchanged workspace in a shell with navigation above and beside it.
2. Change the UI base path to `/tools/slide-library` and configure a different API prefix through the adapter. Search, detail links, refresh and browser back/forward still work.
3. Replace the standalone identity/transport implementation with alternative test adapters. Test denied actions and session expiry through real API enforcement.
4. Change light/dark theme from the parent and mount a second ordinary panel to detect CSS leakage.
5. Run upload, retry, preview, comparison, ordered editable export and access revocation end to end.
6. Build the feature without importing the standalone login or page layout. Document the reusable module's dependencies and the adapter files replaced for the demonstration.

Record commands, fixtures and results so the demonstration is repeatable from a clean checkout.

## Transfer procedure

Deliver a versioned release and checksum inventory, feature/server/worker source, lockfile, dependency licenses, migration and rollback notes, API schema, sanitized fixtures and runbooks. Export only explicitly approved pilot content; a fresh production library is the default.

For approved content transfer, include source/version/slide IDs, ordered collection references, canonical pointers, review provenance, hashes, objects and a mapping for identity/project references. Recompute permissions in the destination; do not transfer sessions or credentials. Validate referential integrity and object hashes before switching traffic. Reindex derived data if it cannot be transferred safely. Keep an access-restricted rollback snapshot for the agreed retention window.

The delivery must include the complete standalone runtime, reusable feature modules, adapters, and a passing portability demonstration. The project owner reviews release evidence, migrations, environment configuration and staging acceptance before scheduling production release. Any future embedding work will define its own destination-specific adapters and migration plan.
