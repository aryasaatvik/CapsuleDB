# Migrations and recovery

CapsuleDB treats migration history as an append-only contract shared by the
author and host. The runtime ledger records the capsule ID, migration ID, name,
checksum, and application time. The metadata row records the complete manifest
fingerprint and provider.

## Normal change flow

1. Add the next contiguous migration ID in the capsule module.
2. Keep the name lowercase and stable; classify the risk as `additive` or
   `destructive`.
3. Add the provider body required by each supported host. Use `sqlMigrationBody`
   for deterministic static SQL; use an Effect body only for transactional
   providers that support it.
4. Check the manifest and, for D1, regenerate and check optional artifacts.
5. Deploy the host and call `prepare` before exposing capsule services.

```sh
bun run capsuledb -- manifest check \
  --module ./src/capsules.ts \
  --export capsule \
  --manifest ./capsuledb.manifest.json \
  --json
bun run capsuledb -- d1 check \
  --module ./src/capsules.ts \
  --export capsule \
  --artifact ./d1-artifacts \
  --json
```

Changing an applied migration's ID, name, provider body, or statement
sequence changes its checksum and fails closed. Create a new migration instead
of editing history. A gap or reordered history is rejected before provider
state is touched.

## Startup states

| State or failure                   | Meaning                                                                   | Host action                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Pending`                          | No complete active history is recorded yet.                               | Run `prepare` in the startup phase.                                                 |
| `Ready`                            | Fingerprint, provider, and every active ledger row agree.                 | Expose the service layer.                                                           |
| `Stale` / `NotReady`               | Metadata or ledger does not match the current registry.                   | Keep the host unavailable; inspect the history and rerun `prepare`.                 |
| `DestructiveMigrationUnauthorized` | A pending destructive migration was found without explicit authorization. | Obtain deployment approval, then pass `allowDestructive: true`.                     |
| `DatabaseAhead`                    | The active database has a migration absent from registered code.          | Restore the exact code or investigate before changing the registry.                 |
| `LedgerConflict` / checksum drift  | Applied name or body differs from the registered history.                 | Do not edit the applied entry; restore matching statements or plan a new migration. |
| `PartialMigration`                 | Ledger and readiness metadata describe an incomplete state.               | Keep services hidden and repair from a backup/provider-specific runbook.            |
| `ProviderMismatch`                 | Persisted metadata was produced for another provider profile.             | Use the original provider or perform an explicit, reviewed migration.               |

## D1-specific recovery

D1 preparation validates every pending claim-first batch before applying the
first one. Each migration then runs as one atomic batch, with no interactive
transaction or savepoint fallback. If a batch fails, the claim and its static
SQL must roll back together; retry only after the provider error is understood.
Dynamic Effect bodies and over-limit batches are definition failures, not a
signal to split work into multiple untracked batches.

Optional SQL artifacts can be deleted and regenerated from the same module and
manifest. `d1 check` is the guard against stale, edited, missing, reordered, or
unsupported files. Artifact regeneration never substitutes for runtime
preparation or ledger verification.

## Removal and recovery of a capsule

An empty or reduced explicit registry does not drop the removed capsule's
tables or ledger rows. This preserves package-owned data. Re-registering the
same capsule ID with its unchanged history allows the runtime to verify and
reuse the existing rows. Treat a changed ID as a new namespace and do not use
it to rename a capsule in place.

## Backups and authorization

CapsuleDB does not provide backup, rollback, DDL diffing, or destructive-change
approval. The host owns those operational controls. Take the provider's normal
backup before an approved destructive migration, run preparation in a
controlled startup/deployment phase, and retain the readiness receipt and
manifest fingerprint with the deployment record.
