# Pagination review record

The maintenance audit found that entity queries sorted by pin, authorization or
registration, descending last-seen time, then ascending ID, but filtered the next
page by ID alone. This could skip or repeat rows. The original maintenance plan
deferred changing that cursor contract; the subsequent review request explicitly
authorized the correction.

Entity pagination now uses the composite cursor described in
[contracts](contracts.md). Live PostgreSQL regressions traverse both catalog and
device pages and compare them to the complete ranked result set. Existing
ID-only cursors must be discarded after upgrade. Changes to ranking inputs
between requests still require restarting pagination when snapshot consistency
is needed; this refactor adds no long-lived database snapshots.
