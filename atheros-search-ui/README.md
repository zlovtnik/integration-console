# Integration Console (atheros-search-ui)

SolidJS/Bun UI for Atheros Search. It talks to the Go service in
[`../atheros-search`](../atheros-search/) over HTTP; it does not touch
PostgreSQL directly.

## Audience

This README is for UI developers. Backend operators should use the
[Atheros Search README](../atheros-search/README.md) for routes, auth, env
vars, and schema contracts.

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
| `POST` | `/v1/graph` | Graph / inventory graph projection |
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

## Auth

The UI sends `Authorization: Bearer <token>` for `/v1/*` routes via
`authenticatedFetch`. In production that is a Keycloak access token; roles
are enforced on the backend. Do not invent client-side-only merge
authorization.

## Local development

Point the UI at a running Atheros Search instance (`VITE_API_BASE` or the
app env module). There is no local inventory mock fallback; the backend
routes above are part of the contract.
