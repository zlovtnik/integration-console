# AGENTS.md

## Scope
This file governs `/Users/rcs/git/ssl-proxy/apps/integration-console` and all
children except where a deeper `AGENTS.md` applies. It supplements the parent
repository instructions.

## Project Shape
- This directory is a git submodule for the Rails 7.2 integration console.
- Ruby is `3.4.4`; Rails uses PostgreSQL, Redis, ActionCable, MinIO/S3 exports,
  OpenTelemetry, Turbo, Stimulus, Vite, and Svelte 5.
- `app/controllers/`, `app/models/`, `app/services/`, and `app/channels/` hold
  the Rails application behavior.
- `app/frontend/` contains the Rails-mounted Svelte/JavaScript UI.
- `db/migrate/` is for console-owned Rails database objects.
- `test/` is the Minitest suite.
- `atheros-search-ui/` is a separate standalone SolidJS application with its
  own instructions.

## Rails Guardrails
- Preserve the primary/sync database split in `config/database.yml`.
- `ApplicationRecord` models own console tables. `SyncRecord` models are
  read-only views into the shared sync database; do not bypass that read-only
  boundary with writes from Rails.
- Shared sync schema changes belong in the parent repo's `sql/` tree, not in
  Rails migrations. Rails migrations should stay focused on console-owned data.
- Keep query timeouts and cache TTL behavior explicit. Prefer existing helpers
  such as `IntegrationConsole::CacheTtl`, `DashboardCache`, and `ExportStore`.
- Keep MinIO export keys deterministic and sanitized; do not put raw user input
  directly into object keys or response headers.
- Keep ActionCable broadcasts and Redpanda subscriber behavior idempotent where
  retries are possible.
- Do not log secrets, API keys, full MAC addresses, or encryption material.
  Respect `INTEGRATION_CONSOLE_FULL_MACS` behavior for MAC display.

## Frontend Guardrails
- Keep Rails-mounted UI in `app/frontend/` using the existing Svelte entrypoint
  pattern and `mountPage` helper.
- Preserve Turbo/Stimulus compatibility for Rails pages.
- Keep dense operational screens scannable: stable table columns, clear empty
  states, accessible form labels, and no layout shifts for polling updates.
- Do not mix the standalone Solid app into Rails entrypoints; work inside
  `atheros-search-ui/` when the task is for that app.

## Commands
- Install/update dependencies: `bundle install` and `bun install`.
- Prepare local DBs: `bin/rails db:prepare`.
- Rails tests: `bin/rails test` or `bin/rails test test/path/to_test.rb`.
- System tests: `bin/rails test:system`.
- Rails asset build: `bun run build`.
- Local app: `bin/dev` or `bin/rails server` plus `bun run dev`.

## Verification
- Run targeted Rails tests for changed controllers, models, services, channels,
  helpers, or views.
- Run `bun run build` when touching `app/frontend/`, Vite config, package
  dependencies, or frontend entrypoints.
- If tests need Postgres, Redis, MinIO, or Redpanda that are not running, state
  exactly what was skipped and why.
