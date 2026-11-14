# Atheros Search service-local migrations

This directory does not own the shared runtime schema. Canonical Atheros Search
DDL and its checksummed apply order live in
[`sql/postgres/atheros_search`](../../../../sql/postgres/atheros_search/).

Add a migration here only for a future object that is truly private to this Go
module and independent of the repository runtime contract. Atheros Search
verifies the canonical manifest at startup and never applies DDL.

There are no service-local SQL migrations in this directory. Changes to shared
tables, indexes, vector stores, grants or readiness contracts belong in the
canonical domain manifest and [grant templates](../../../../sql/postgres/atheros_search/grants/).
Only the provisioning schema executor applies that DDL; API and worker startup
verify the recorded checksum and fail closed on a mismatch.

Validate schema-dependent changes from the parent workspace with
`make atheros-search-db-contract`. This required check uses an isolated
PostgreSQL container and verifies runtime grants as well as query contracts;
it requires Docker and the parent's Python test requirements.
