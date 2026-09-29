# Host-operator contract

The host application decides which trusted capsules to compose and supplies a
provider client that the host already owns. CapsuleDB coordinates validation,
ledger state, migration application, and readiness; it never opens, closes, or
replaces that client.

## Compose and prepare

Choose the profile matching the host client. Registry composition is explicit,
so startup does not discover packages or infer migrations:

```ts
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { Pg, Registry } from "capsuledb";
import { capsule } from "./capsule.js";

export const CapsulesLive = Registry.layer({
  provider: Pg.profile,
  capsules: [capsule],
});

const application = Effect.service(CapsuleService).pipe(
  Effect.provide(CapsulesLive),
  Effect.provideService(SqlClient.SqlClient, hostOwnedSqlClient),
);
```

`Registry.layer` runs preparation while the layer is built and only then
provides each capsule's service, so a service can never observe a database
whose tables are missing. Preparation first reads the metadata and ledger in one
statement; a registry that is already current is Ready from that read, with no
transaction, lock, or DDL. Otherwise it ensures the runtime ledger and metadata
exist, validates existing entries, and applies pending migrations under a
PostgreSQL advisory lock. If it fails, the layer fails: keep the host unhealthy
and surface the typed failure rather than continuing with a partially prepared
registry.

`Registry.prepare(options)` is the same work as an `Effect` for a host that
wants an explicit startup step, and it answers with the `Ready` readiness
value. The service layers are package-owned and may require `SqlClient` and
other host services; the host still owns the client lifetime and the
authorization policy.

## Readiness and repeated startup

`Registry.status(options)` reports one readiness union: `Pending` (with the
migrations still to run), `Ready`, or `Drift` (with the reason preparation
cannot repair the disagreement). A `Ready` result is valid only when the
metadata fingerprint, provider, and complete active ledger all agree with the
current registry. `Registry.assert(options)` is the cheap fail-closed
assertion for a host that has already completed preparation; it fails with
`NotReady` in every other state.

Do not treat a metadata row by itself as readiness. A missing ledger row,
checksum/name conflict, provider mismatch, database-ahead row, or partial
migration keeps the registry unavailable and requires operator investigation.

## Serverless hosts: prepare at deploy time

A serverless function builds its layers on every cold start, so even one read
per registry is latency on a request that may never touch a capsule. Move
preparation to the deploy and make the runtime check lazy.

At deploy time, the `capsuledb/alchemy` subpath prepares the database from the
registry's manifest before the new function version publishes:

```ts
import * as CapsuleDB from "capsuledb/alchemy";
import { Pg, Registry } from "capsuledb";

// In the Alchemy stack, with CapsuleDB.providers() merged into its providers.
const registry = Effect.gen(function* () {
  const manifest = yield* Registry.manifest({ provider: Pg.profile, capsules: [capsule] });
  return yield* CapsuleDB.Registry("capsules", {
    url: databaseUrl,
    provider: "Postgres",
    manifest,
  });
});
```

Pass the resource's `fingerprint` output to the function as a version-scoped environment
value, not through a runtime-fetched secret: the dependency is what orders the
function after the preparation, and an older version keeps reading the value it
shipped with. The resource's props and lifecycle:

| Prop                                                     | Meaning                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `url`                                                    | `Redacted` connection URL; the resource opens and closes its own client |
| `provider`                                               | `"Postgres"`                                                            |
| `manifest`                                               | output of `Registry.manifest`, verified before any statement            |
| `prefix`, `allowDestructive`, `allowLegacyLedgerUpgrade` | as for `Registry.layer`                                                 |

- Reconcile runs `Registry.prepare` from the manifest and outputs `fingerprint`,
  the ledger `provider`, the number of `capsules`, and `prefix`. An unchanged
  deploy, a rerun, and adoption of a database the runtime already prepared each
  converge with one read and no DDL.
- Diff updates only when the URL, provider, prefix, authorizations, or manifest
  fingerprint change.
- Delete keeps every table. Dropping capsule data is an operator decision made
  with a destructive migration, never a side effect of removing the resource.
- A migration with an Effect step has no SQL form and fails reconcile with
  `InvalidDefinition`; keep that capsule on runtime preparation.

`alchemy` and `@effect/sql-pg` are optional peer dependencies used only by this
subpath; the package root never loads them. The same preparation is available
without Alchemy as `Registry.prepare({ provider, manifest })` for any deploy
tool that holds the manifest as JSON.

At run time, assert instead of preparing, and do it on first use:

```ts
Registry.layer({
  provider: Pg.profile,
  capsules: [capsule],
  mode: "assert",
  readiness: "first-use",
});
```

`readiness: "first-use"` builds the layer without a statement. Capsules receive
the host client wrapped so their first connection, reservation, or transaction
runs the `mode` check once; concurrent first uses share it and a success is kept
for the layer's lifetime. A failure reaches the capsule's query as a `SqlError`
whose cause is the registry error (`NotReady` here), and the next use checks
again, so a deploy that finishes preparing heals running instances without a
restart. The check runs outside any transaction the caller has open. Composition
errors, such as a duplicate capsule, still fail the build. Tests and local
development can keep `mode: "prepare"` with either readiness.

## Destructive authorization

Destructive migrations are denied by default. An operator must make the
authorization visible for the specific preparation run:

```ts
Registry.layer({ provider: Pg.profile, capsules: [capsule], allowDestructive: true });
```

The runtime checks every pending destructive migration before applying an
earlier additive migration in that run. CapsuleDB does not decide whether a
deployment is approved; the host supplies that policy.

## Emit SQL instead of migrating at boot

A host that already owns a migration pipeline — Drizzle, Atlas, a deploy job
running `psql` — can take CapsuleDB's SQL and apply it itself. `emit` writes the
migrations, the ledger DDL, and the ledger rows into a folder; `check` verifies
that folder still matches the library you have installed:

```sh
bunx capsuledb emit  --module ./node_modules/acme/dist/capsule.js --export capsule \
  --dialect postgres --out ./drizzle
bunx capsuledb check --module ./node_modules/acme/dist/capsule.js --export capsule \
  --dialect postgres --out ./drizzle
```

```text
./drizzle
  0000_capsuledb_ledger.sql          ledger + readiness metadata DDL
  0001_capsule_acme_tokens_...sql    one migration, then its ledger row
  0002_capsuledb_readiness.sql       the readiness metadata row
  capsuledb.emit.json                which files in this folder CapsuleDB owns
```

Then boot with `mode: "assert"`. The Layer applies nothing and fails with
`NotReady` unless the database already matches the registered history:

```ts
Registry.layer({ provider: Pg.profile, capsules: [capsule], mode: "assert" });
```

|                            | `prepare` (default)                         | `emit` + `mode: "assert"`                |
| -------------------------- | ------------------------------------------- | ---------------------------------------- |
| Who applies DDL            | CapsuleDB, at boot                          | your pipeline, at deploy                 |
| Reviewable SQL in the repo | no                                          | yes                                      |
| Effect migration steps     | supported                                   | rejected; they have no SQL form          |
| Boot cost                  | one read when current, else the locked path | one read                                 |
| Drift caught               | at boot                                     | at `check` time in CI, and again at boot |

`capsuledb.emit.json` records which files CapsuleDB owns, so an emit folder can
be shared with the host's own migrations. Regeneration replaces the files it owns
and deletes the ones a rename made obsolete, but only when the index claims the
path _and_ the file still carries the generated header — take a claimed path over
with your own SQL and `emit` stops and tells you rather than deleting it. `check`
ignores everything the index does not claim. Commit the index with the SQL.

Run `check` in CI. It fails when the installed library has a migration the
folder does not, when a file was edited, when a file belongs to another dialect,
and when the folder holds a CapsuleDB file the projection no longer emits.

Files are numbered by CapsuleDB's own migration order rather than by wall clock,
so the projection is byte-for-byte reproducible and `check` can compare it
directly. They sort exactly as a timestamped folder does. Pass `--provider` when
the SQLite dialect is not Bun SQLite (`Libsql`, `D1`), and `--prefix` when the
registry uses one, so the emitted ledger rows match what the runtime expects.

## Sharing a database between registries

CapsuleDB owns two tables of its own. `prefix` renames them, so two independent
registries — a second application, or a tenant-scoped deployment — can share one
database:

```ts
Registry.layer({ provider: Pg.profile, capsules: [capsule], prefix: "tenant" });
```

The default is `capsuledb`. The prefix is part of the physical layout: changing
it after a deployment hides the existing ledger and makes every applied
migration look pending.

## Removal and re-registration

Removing a capsule from the explicit registry does not drop its tables or
ledger rows. This preserves data and makes an accidental temporary removal
recoverable. Re-registering the same capsule ID resumes against its existing
history. A changed ID derives a different namespace and is a new logical
capsule, not a rename.

## Provider clients

Use the host's existing Effect SQL client layer. The client may be shared with
other host-owned persistence (including an Effect Drizzle adapter), but the
CapsuleDB seam is the generic `SqlClient.SqlClient` service. Do not pass a
Drizzle query object where a `SqlClient` is required and do not create a second
connection per capsule. See the [provider matrix](providers.md) for capability
and D1 limits.

## CLI and deployment boundary

The CLI's manifest and optional D1 artifact commands are build-time checks.
They do not deploy to D1, invoke Wrangler, configure bindings, or mutate a
database. A host may check a packed manifest/artifact in CI. Whichever path
prepared the database — runtime preparation, `emit` output, or the Alchemy
resource — the runtime readiness check is authoritative.

## Design-partner sketches

[`examples/samva-shared-client.ts`](../examples/samva-shared-client.ts) shows
how a host with a shared Effect Drizzle client can pass the underlying
host-owned SQL seam to CapsuleDB. [`examples/executor-plugin.ts`](../examples/executor-plugin.ts)
shows a boot-time plugin registry shape, and
[`examples/serverless-alchemy.ts`](../examples/serverless-alchemy.ts) shows
deploy-time preparation with a first-use runtime check. They are integration
sketches for discussion; neither Samva nor Executor adoption is claimed by this
repository.
