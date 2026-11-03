# Integration Console (atheros-search-ui)

SolidJS/Bun UI for Atheros Search. It talks to the Go service in
[`../atheros-search`](../atheros-search/) over HTTP; it does not touch
PostgreSQL directly.

For the product architecture, engineering approach and repository map, see the
[Atheros Search README](../README.md).

## Audience

This README is for UI developers. Backend operators should use the
[Atheros Search README](../atheros-search/README.md) for routes, auth, env
vars, and schema contracts.

## Reporting direction

The source-reviewed [reporting workmap](../../../docs/atheros-reporting-workmap.md)
defines the business questions, accuracy findings, simple controls and staged
redesign for Inventory, network map, identity review, Search and Explain. The
[reporting data contract](../../../docs/atheros-reporting-data-contract.md)
documents table grains, relationship meanings and provenance. Implementation is
tracked in the [reporting plans](../../../plans/README.md). Use the current code
and contracts below for available capabilities; workmap items are not evidence
that a feature has shipped.

The initial inventory grain is an observed MAC identifier. Observed AP links,
pending identity candidates and confirmed identity membership have distinct
meanings. Do not use missing links as threat evidence or scores as identity
probabilities. Keep report context and completeness visible.

## Commands

```bash
bun install
bun run dev
bun run test
bun run lint
bun run build
bun run test:e2e
```

`bun run build` runs `tsc --noEmit` before `vite build`.

Playwright starts the Vite server itself and runs Chromium desktop and mobile
projects. Install its browser runtime with `bunx playwright install chromium`
before the first browser test. `PLAYWRIGHT_PORT` selects an alternate dev port
when 5173 is occupied. Browser fixtures do not establish live platform health.

## API contract used by the UI

The UI uses these endpoints (snake_case JSON, RFC 3339 timestamps):

| Method | Path | UI usage |
|---|---|---|
| `POST` | `/v1/search` | Search page |
| `POST` | `/v1/search/stream` | NDJSON search results and completion metadata |
| `POST` | `/v1/explain/scoped` | Record detail page: ranking factors in the caller's scope |
| `GET` | `/v1/records/{source_key}/context` | Record detail page: record, activity rate, related devices, embedding work |
| `GET` | `/v1/suggest/filters` | Filter autocomplete |
| `POST` | `/v1/graph` | Network graph projection |
| `POST` | `/v1/network-map` | Network map report |
| `POST` | `/v1/investigation` | Device/AP investigation in the selected scope |
| `POST` | `/v1/evidence` | Evidence page for the same anchor and scope |
| `POST` | `/v1/inventory` | Inventory graph and dedup queue |
| `GET` | `/v1/inventory/merge-candidates/{candidate_id}` | Merge candidate detail |
| `POST` | `/v1/inventory/merge-candidates/{candidate_id}/decision` | Merge, not-a-match, needs-more-data |
| `POST` | `/v1/dedup/runs` | Explicit opt-in DQ candidate preparation |
| `GET` | `/v1/dedup/runs/{run_id}` | DQ processing status and projection application |

Types live in `src/api/types.ts`. The HTTP client is `src/api/client.ts`.

### DQ workspace

The `/dq/*` routes use runtime availability from `GET /v1/dq/context`. When
enabled, `/dq` hosts candidate review and deeper routes load the DQ manager's
embedded shell from `/dq-ui/embedded.html`. The authenticated host brokers
approved `/v1/dq/*` operations through `src/dq/bridge.ts`; bearer tokens stay in
the host and never enter the sandboxed frame. Opening the workspace does not
admit a processor run. Inventory's dedup queue redirects to this workspace when
the runtime context enables it.

Set `VITE_DQ_BETA_ENABLED=true` to show the DQ processing panel in the dedup
queue's legacy review surface. This build-time flag is separate from runtime
workspace availability. It is disabled by default and never starts a run on
page load or decision submission. An operator enters an authorized location and
approved policy before
requesting candidate preparation. Admission retries reuse the same idempotency
identity, and status polling stops at completion or an error. The panel keeps
"decision recorded", "run completed", and "projection applied" distinct.
The backend independently enforces access and beta policy. DQ service credentials
belong on the API server and must never enter a `VITE_*` variable.

### Merge decisions are final

Allowed decisions: `merge`, `not_match`, `needs_more_data`.

There is no undo. After a successful decision the UI removes the candidate
node from local inventory state and does not offer restore. Failed decisions
leave the candidate in place and surface `inventoryError`.

Response shape:

```ts
{
  candidate_id: string;
  decision: MergeDecision;
  accepted: boolean;
  decided_by?: string;
  decided_at?: string;
}
```

### Graph kinds

UI node kinds: `device`, `cluster`, `ap`, `client`, `alert`,
`shadow_alert`, `embedding`.

UI edge kinds: `association`, `probe`, `cluster_member`, `shadow`,
`alert_ref`, `rf_proximity`, `roaming`, `same_channel`, `vendor_link`.

Inventory grouping: `registry` | `cmdb` | `similarity`.

The stored graph edge `observed_at` maps to API `association`; it currently
represents wireless frames observed with a BSSID, not a verified connection.
Inventory similarity groups and `same_device` edges are synthesized from
pending review pairs. They must not be described as confirmed asset identity.

### Search capabilities

The selector offers wireless event, device, proxy event, blocked-host window and
All sources (Cross) search. Behaviour and sequence are retired public search
modes and are not offered. Document preparation support does not imply a
supported public search mode or populated deployment.

## Auth

The UI sends `Authorization: Bearer <token>` for `/v1/*` routes via
`authenticatedFetch`. In production that is a Keycloak access token; roles
are enforced on the backend. Do not invent client-side-only merge
authorization.

## Local development

Run commands from this directory. Create `.env.local` using
[`.env.example`](.env.example) as the configuration reference, then configure:

| Setting | Purpose |
|---|---|
| `VITE_API_BASE` | Browser-reachable API origin; empty uses the UI origin |
| `VITE_KEYCLOAK_URL` | Browser-reachable identity-provider origin |
| `VITE_KEYCLOAK_REALM` | Keycloak realm used by the API issuer |
| `VITE_KEYCLOAK_CLIENT_ID` | Public browser client with the API's expected roles/audience |
| `VITE_APP_TITLE` | Optional application title |
| `ATHSEARCH_DEV_API_ORIGIN` | Vite's server-side proxy target for `/dq-ui/` and `/v1/dq/`; defaults to `http://127.0.0.1:8080` |

Vite serves `http://127.0.0.1:5173`. Register that origin and its `/callback`
redirect URI in the development Keycloak client. When `VITE_API_BASE` points to
a separate origin, configure the API's `ATHSEARCH_CORS_ALLOWED_ORIGINS` to admit
the UI origin. Vite proxies only the DQ paths listed above; other `/v1/` calls
need the configured API base or a same-origin reverse proxy.

All three Keycloak values are needed to enable the browser login flow. Leaving
them unset bypasses the local browser login gate and supplies no bearer token;
it does not grant access to an authenticated API. Never put API tokens, database
passwords or DQ service credentials into `VITE_*` values, which are bundled into
the browser application. Restart Vite after changing environment settings.

There is no runtime inventory mock fallback. A live API and its provisioned
database are required for operator workflows; unit/browser fixtures are test
inputs only. Production routing and image promotion follow the parent
[GitOps guide](../../../cyber-stack/README.md).
