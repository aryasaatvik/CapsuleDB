## capsuledb@0.2.0

### Deterministic manifests, optional D1 artifacts, and provider-stamped readiness

The manifest is deterministic, the static D1 artifact tooling is optional, and capsule authors and
host operators each get their own documentation. Registry readiness fails closed when an active
migration ledger row was stamped by a different provider.

### Declare tables once and render the DDL per dialect

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

### Make capsule definitions pure values and boot every capsule from one Layer

`Capsule.make` and `Migration.make` now return the value and throw
`CapsuleDefinitionError` on an invalid definition, so a capsule is a module
constant instead of an Effect a host has to run first. `Registry.layer(options)`
prepares pending migrations and then provides every registered capsule's
service with its merged service, failure, and requirement types.

Breaking: the root export is namespace-only (`Capsule`, `Migration`, `Registry`,
...); `makeCapsule`, `makeMigration`, `sqlMigrationBody`, `effectMigrationBody`,
`makeRegistry`, `describe`, `migrationsOf`, and `assertRegistryReady` are gone.
`RegistryPlanState`, `Readiness`, and `ReadinessReceipt` collapse into one
`Readiness` union of `Ready`, `Pending`, and `Drift`.

### Emit capsule SQL into a host's migration folder and assert readiness at boot

`capsuledb emit --module --export --dialect postgres|sqlite --out <dir>` writes
the ledger DDL, one file per migration with its ledger row, and the readiness
metadata row. `capsuledb check` verifies that folder still matches the installed
library. `Registry.layer({ mode: "assert" })` then applies nothing and fails with
`NotReady` unless the database already matches the registered history.

Files are numbered by CapsuleDB's own migration order rather than by wall clock,
so the projection is byte-for-byte reproducible and `check` can compare it
directly. `--provider` stamps a non-default SQLite provider identity and
`--prefix` matches a prefixed registry.

### Checksum only the dialect body the host applies

Manifest v2 gives every dialect body its own checksum, and the ledger records
which dialect a row's checksum is keyed to. Adding a SQLite body to a capsule
already deployed on PostgreSQL, or fixing another engine's SQL, no longer
invalidates a deployed host's ledger. `MigrationChecksumDrift` and
`LedgerConflict` name the dialect that drifted.

A ledger written by CapsuleDB 0.1 is upgraded in place on the first v2
preparation: the runtime adds the `dialect` column and re-keys each row to the
body this host applies. It still fails closed when a row's capsule, migration ID,
or name no longer matches the registered history.

### Prune the export surface and ship a conformance kit

`capsuledb/Testing` exports the provider-neutral conformance suite this
repository runs against every provider, plus a `withSqlite` helper that opens a
throwaway in-memory database, so a capsule author gets a first signal without
testcontainers. `Registry.layer` and friends accept a `prefix` so two
independent registries can share one database.

Breaking: `TokenNotFound`, `TokenAlreadyConsumed`, and `InvalidToken` were
example-only errors and now live in the reference example rather than the
library's `CapsuleError` union.

`bun run docs:check` now verifies that every `capsuledb` subpath and symbol a
documentation snippet names still exists, and `tests/artifact` asserts the packed
root surface is exactly one namespace per exported subpath.

## capsuledb@0.1.0

### The first capsule

The first public release of CapsuleDB, providing Effect-native database capsules,
append-only migrations, and transactional PostgreSQL, Bun SQLite, and libSQL
provider support.
