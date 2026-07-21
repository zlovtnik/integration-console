# Runtime schema ownership

The Integration Console does not create or migrate runtime tables. The
canonical, append-only TiDB schema lives in the parent repository under
`sql/tidb/integration_console/` and is applied only by the dedicated DDL job.
Application credentials intentionally have no DDL grants.

`legacy_postgresql_migrate/` and `legacy_postgresql_schema.rb` are historical
parity inputs. Rails does not discover or execute them. Do not add new runtime
migrations here; add a canonical TiDB migration in the parent repository and
update the pinned readiness version/checksum instead.
