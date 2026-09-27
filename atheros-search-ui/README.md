# Integration Console (atheros-search-ui)

SolidJS/Bun UI for Atheros Search. It talks to the Go service in
[`../atheros-search`](../atheros-search/) over HTTP; it does not touch
PostgreSQL directly.

## Audience

This README is for UI developers. Backend operators should use the
[Atheros Search README](../atheros-search/README.md) for routes, auth, env
vars, and schema contracts.

## Reporting direction

The source-reviewed [reporting workmap](../../../docs/atheros-reporting-workmap.md)
defines the business questions, accuracy findings, simple controls and staged
redesign for Inventory, network map, identity review, Search and Explain. The
[reporting data contract](../../../docs/atheros-reporting-data-contract.md)
documents table grains, relationship meanings and provenance. Implementation
is tracked in [three plans](../../../plans/README.md); these are proposed changes,
not current UI capabilities.

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

## API contract used by the UI

The UI uses these endpoints (snake_case JSON, RFC 3339 timestamps):

| Method | Path | UI usage |
|---|---|---|
| `POST` | `/v1/search` | Search page |
| `GET` | `/v1/explain/{source_key}` | Result explain panel |
| `GET` | `/v1/suggest/filters` | Filter autocomplete |
| `POST` | `/v1/graph` | Network graph projection |
| `POST` | `/v1/inventory` | Inventory graph and dedup queue |
| `POST` | `/v1/inventory/merge-candidates/{candidate_id}/decision` | Merge, not-a-match, needs-more-data |

Types live in `src/api/types.ts`. The HTTP client is `src/api/client.ts`.

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

The current backend supports wireless event, device, proxy event, blocked-host
window and Cross search. Behaviour and sequence search are retired by the Go
API even though the current UI still offers those choices. Removing that UI/API
mismatch is tracked in the reporting accuracy plan. Document preparation support
does not imply a supported public search mode or populated deployment.

## Auth

The UI sends `Authorization: Bearer <token>` for `/v1/*` routes via
`authenticatedFetch`. In production that is a Keycloak access token; roles
are enforced on the backend. Do not invent client-side-only merge
authorization.

## Local development

Point the UI at a running Atheros Search instance (`VITE_API_BASE` or the
app env module). There is no local inventory mock fallback; the backend
routes above are part of the contract.
