---
"capsuledb": minor
---

Declare tables once and render the DDL per dialect.

`Schema.table` plus the column constructors describe a capsule's tables, and
`Migration.createTable`, `addColumn`, `createIndex`, and `dropTable` render them
deterministically for PostgreSQL and SQLite — the dialect that covers Bun SQLite,
libSQL, and Cloudflare D1. `Migration.sql` stays the escape hatch for
engine-specific statements and `Migration.effect` for work that needs the host
client; one migration may mix all three. `capsule.tables` exposes the
declaration, and `Schema.Row` infers the row type from it.

Breaking: a migration takes `steps`, not a `providers` map keyed by provider or
dialect tag, and bodies are keyed by dialect (`postgres` / `sqlite`) only.
`Provider` and `Dialect` are string unions rather than tagged unions, and
`ProviderProfile.execution` is gone because `capabilities._tag` already names the
execution model. The manifest records per-dialect `bodies` in place of
`providers`. The built-in D1 profile now allows 16 statements per atomic batch
instead of 2; Cloudflare publishes no batch statement-count limit, and one
declared table with indexes needs more than one slot.
