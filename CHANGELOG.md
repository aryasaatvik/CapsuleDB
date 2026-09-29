## capsuledb@0.4.0

### A current registry answers in one round trip

`Registry.prepare`, `Registry.assert`, and `Registry.status` read readiness metadata and the whole
ledger in one statement. When the recorded fingerprint matches and the ledger is complete,
`prepare` returns `Ready` from that read alone: no transaction, no PostgreSQL advisory lock, and no
`CREATE TABLE IF NOT EXISTS`. Anything else — missing tables, a new migration, a ledger that still
needs re-keying — takes the locked preparation path unchanged. Inside a caller's transaction the
read runs under a savepoint, so an empty PostgreSQL database cannot abort that transaction.

### Check readiness on first use

`Registry.layer({ ..., readiness: "first-use" })` builds without a single statement. Capsules
receive the host `SqlClient` wrapped so their first connection, reservation, or transaction runs the
`mode` check (`prepare` or `assert`) once; concurrent first uses share it, a success is kept for the
Layer's lifetime, and a failure reaches the capsule's query as a `SqlError` whose cause is the
registry error and runs again on the next use. Driver-specific members such as D1's `batch` stay on
the wrapped client and are gated the same way. Composition errors still fail the build. The default,
`readiness: "boot"`, checks while the Layer is built, as before.

### Prepare from a manifest

`Registry.prepare`, `Registry.assert`, and `Registry.status` also take
`{ provider, manifest, prefix?, allowDestructive?, allowLegacyLedgerUpgrade? }`, so a deploy tool
can prepare a database from the serialized output of `Registry.manifest` without loading capsule
code. The manifest's structure, body checksums, and fingerprint are verified before the database is
touched, and its SQL bodies for the provider's dialect are what gets applied. A migration with an
Effect step fails with `InvalidDefinition`, as `emit` does. The ledger and metadata are written
exactly as capsule preparation writes them, so either path reads the other's database as Ready.

### `capsuledb/alchemy`: prepare the registry at deploy time

The new `capsuledb/alchemy` subpath exports a `CapsuleDB.Registry` Alchemy resource and its
`providers()` collection. Given a PostgreSQL connection `url`, `provider: "Postgres"`, and the
registry `manifest`, reconcile prepares the database from the manifest and outputs its
`fingerprint`, ledger `provider`, capsule count, and `prefix`. Diff updates only when the URL,
provider, prefix, authorizations, or manifest fingerprint change; an unchanged or already-prepared
database reconciles with a single read, and delete keeps every table. `alchemy` (`>=2.0.0-beta.79
<3`) and `@effect/sql-pg` (`>=4.0.0-rc.117 <5`) are optional peer dependencies used only by this
subpath; the package root never imports them.

## capsuledb@0.3.0

### Effect 4.0.0-rc.117

CapsuleDB builds against Effect `4.0.0-rc.117`, and the `effect`, `@effect/sql-libsql`, and
`@effect/sql-sqlite-bun` peer ranges are now `>=4.0.0-rc.117 <5`. Effect renamed the CLI flag
constructors to `Flag.Boolean` and `Flag.String`, and `0.2.0`'s `capsuledb` bin calls the old
lowercase names at import, so every subcommand crashes under Effect `rc.113` or newer. A host on a
newer Effect needs this release, and a host on an older one upgrades Effect with it.

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
