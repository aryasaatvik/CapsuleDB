# Design principles

What CapsuleDB is, what it refuses to be, and why. This describes the contract
as it stands; it is not a record of how it got here.

## The seam is the host's `SqlClient`

A host owns a database connection and its lifetime. CapsuleDB coordinates
migration and provides a capsule's domain layer over the client the host already
has. It never opens, closes, replaces, or pools a connection, and no public
module exports tables, rows, query builders, raw driver clients, connection
constructors, or a Promise facade.

The precedent is Effect's own SQL layer: `SqlClient` stays an environment
service and drivers own their resources. CapsuleDB sits on the same seam rather
than inventing a second one.

## A capsule is a value

```ts
interface Capsule<Service, Failure, Requirements = SqlClient.SqlClient> {
  readonly id: CapsuleId;
  readonly namespace: CapsuleNamespace;
  readonly tables: ReadonlyArray<Schema.Table>;
  readonly migrations: ReadonlyArray<Migration>;
  readonly layer: Layer.Layer<Service, Failure, Requirements>;
}
```

The definition constructors are pure and throw `CapsuleDefinitionError` on
invalid input, so a capsule is a module-level constant a host can import and
compose without running an Effect first. An invalid definition is authored code
that needs fixing, not a failure a caller recovers from.

The service is an Effect `Layer`, not a factory function, because a `Layer`
carries the service's typed failures and its own requirements across the package
boundary. A descriptor with a `(client) => Effect` field would erase both and
invite callers to hand a client around directly.

`Registry.layer` builds preparation first and the capsule layers second, so a
capsule service can never observe a database whose tables are missing.

## Identity is derived, never configured

A capsule's physical namespace is derived from its validated logical ID by an
injective encoding. A host cannot rename it. Mutable physical identity would
undermine collision detection and make a manifest fingerprint meaningless. A
changed ID is a different capsule, not a rename.

The two tables CapsuleDB's own lifecycle owns take a `prefix` so two independent
registries can share a database. That is layout, not identity: it is fixed at
first deploy and never varies per capsule.

## Declare a table once; render it per dialect

Authors declare tables with `Schema.table` and CapsuleDB renders deterministic
DDL for PostgreSQL and SQLite, where SQLite covers Bun SQLite, libSQL, and D1.
`Migration.sql` remains the escape hatch for engine-specific statements and
`Migration.effect` for work that needs the client; a migration may mix all three.

Names CapsuleDB quotes into DDL are restricted to plain SQL identifiers so a
name cannot close the quote it is rendered into. Expressions an author supplies
— a check, an index predicate, a default, a raw body — are rendered verbatim.
CapsuleDB does not parse or sandbox author SQL: package authors are trusted, and
remain responsible for avoiding cross-capsule physical composition.

## Checksums cover one dialect

A migration checksum covers only the body a host applies, so adding an engine
after shipping does not invalidate a deployed host's ledger. Effect steps are
identified by an immutable author-assigned revision, because a function cannot
be serialized into a manifest and CapsuleDB will not claim function
equivalence.

Provider identity, SQL dialect, and execution capability stay separate: several
providers share one dialect, and a profile's capabilities are what decide how
migrations execute. D1 is atomic-batch-only and cannot advertise interactive
transactions, savepoints, streaming, or Effect steps.

## Two paths to a migrated database, one ledger

Runtime preparation is the default: `Registry.layer` applies pending migrations
under a claim-first ledger and a readiness contract. A host that owns its own
migration pipeline instead runs `capsuledb emit` for reviewable SQL — including
the ledger DDL and rows — and boots with `mode: "assert"`, which applies nothing
and refuses to start unless the database already matches.

Both paths produce the same ledger, so readiness means one thing. Emitted files
are a projection of the same definitions, and `check` is what keeps them honest.
The optional static D1 artifacts are the same idea, narrowed to D1's bounded
atomic batch; neither projection is runtime authority on its own.

## Composition is explicit

A host names the capsules it trusts. CapsuleDB never scans dependencies, infers
installed packages, or discovers capsules, and the CLI requires an explicit
module and export. What a release does must not depend on installation topology.

## What CapsuleDB is not

- Not an ORM. Persistence details are the capsule's, not the public contract.
- Not a deployment service. It does not invoke Wrangler, configure accounts, or
  manage provider resources.
- Not a second connection lifecycle. The host's client stays the host's.
