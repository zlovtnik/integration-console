# AGENTS.md

## Scope
This file governs `/Users/rcs/git/ssl-proxy/apps/integration-console/atheros-search-ui`.
It supplements the parent integration-console and repository instructions.

## Project Shape
- This is a standalone SolidJS, TypeScript, Vite, and Bun application.
- `src/api/` owns HTTP clients, response types, streaming search parsing, and
  test mocks.
- `src/stores/` owns shared Solid stores.
- `src/hooks/` owns URL sync, keyboard handling, search streams, inventory
  loading, and graph layout behavior.
- `src/components/` and `src/pages/` own UI composition.
- `src/styles/` contains reset, tokens, typography, graph, and inventory CSS.
- `tests/unit/` uses Vitest; `tests/e2e/` uses Playwright and axe.

## Solid And TypeScript Guardrails
- Keep `tsconfig.json` strict settings intact, including
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Preserve Solid fine-grained reactivity. Avoid destructuring props, stores, or
  accessors in ways that break tracking.
- Use `createMemo`, `createEffect`, `on`, `children`, stores, and cleanup
  functions according to the patterns already present in the codebase.
- Clean up timers, abort controllers, event listeners, D3 simulations,
  animation frames, WebGL/Three resources, and network streams.
- Keep API parsing defensive: tolerate missing optional fields, validate
  timestamps, and surface friendly errors through existing helpers.
- Preserve request cancellation and timeout behavior in streaming search and
  inventory flows.

## UI Guardrails
- Keep the operational UI dense, accessible, and keyboard navigable.
- Preserve existing color tokens and component structure before adding new
  styling primitives.
- Maintain skip links, focus handling, labels, table semantics, and axe-covered
  accessibility behavior.
- For force graphs and 3D inventory views, guard against non-finite coordinates,
  premature measurements, blank canvases, and layout rebuild loops.
- Do not edit `dist/` unless the task explicitly asks for generated production
  assets.

## Commands
- Install/update dependencies: `bun install`.
- Typecheck and build: `bun run build`.
- Lint: `bun run lint`.
- Unit tests: `bun run test:unit`.
- All Vitest tests: `bun run test`.
- E2E tests: `bun run test:e2e`.
- Accessibility E2E: `bun run test:a11y`.
- Dev server: `bun run dev` on `127.0.0.1:5173` with `strictPort`.

## Verification
- Run `bun run build` for TypeScript, Vite, API, hook, store, or component
  changes.
- Run targeted unit tests for changed hooks, stores, API parsing, utilities, or
  components.
- Run Playwright tests when changing navigation, layout, keyboard behavior,
  graph rendering, or accessibility-sensitive UI.
