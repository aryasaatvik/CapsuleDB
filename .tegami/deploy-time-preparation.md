---
packages:
  capsuledb:
    type: minor
---

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
registry error and runs again on the next use. Composition errors still fail the build. The default,
`readiness: "boot"`, checks while the Layer is built, as before.

### Prepare from a manifest

`Registry.prepare`, `Registry.assert`, and `Registry.status` also take
`{ provider, manifest, prefix?, allowDestructive?, allowLegacyLedgerUpgrade? }`, so a deploy tool
can prepare a database from the serialized output of `Registry.manifest` without loading capsule
code. The manifest's structure, body checksums, and fingerprint are verified before the database is
touched, and its SQL bodies for the provider's dialect are what gets applied. A migration with an
Effect step fails with `InvalidDefinition`, as `emit` does. The ledger and metadata are written
exactly as capsule preparation writes them, so either path reads the other's database as Ready.
