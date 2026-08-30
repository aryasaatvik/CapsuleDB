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

import { Pg, makeRegistry, prepare } from "capsuledb";
import { capsule } from "./capsule.js";

const bootCapsule = Effect.gen(function* () {
  const registry = yield* makeRegistry({
    provider: Pg.profile,
    capsules: [capsule],
  });
  return yield* prepare(registry);
}).pipe(Effect.provideService(SqlClient.SqlClient, hostOwnedSqlClient));
```

Call `prepare` during the host's startup/readiness phase. It ensures the
runtime ledger and metadata exist, validates existing entries, applies pending
migrations, and returns a `ReadinessReceipt` containing the manifest
fingerprint and provider. Do not expose capsule services to requests before
this effect succeeds. If preparation fails, keep the host unhealthy and
surface the typed failure; do not continue with a partially prepared registry.

To use an opaque service, compose the capsule's layer with the same
host-owned client after preparation:

```ts
const application = Effect.gen(function* () {
  const registry = yield* makeRegistry({ provider: Pg.profile, capsules: [capsule] });
  yield* prepare(registry);
  return yield* Effect.service(CapsuleService);
}).pipe(
  Effect.provide(capsule.layer),
  Effect.provideService(SqlClient.SqlClient, hostOwnedSqlClient),
);
```

The service layer is package-owned and may require `SqlClient`; the host still
owns the client lifetime and authorization policy.

## Readiness and repeated startup

`status(registry)` reports `Pending`, `Ready`, or `Stale`. A `Ready` result is
valid only when the metadata fingerprint, provider, and complete active ledger
all agree with the current registry. `assertRegistryReady` is the cheap
fail-closed assertion for a host that has already completed preparation.

Do not treat a metadata row by itself as readiness. A missing ledger row,
checksum/name conflict, provider mismatch, database-ahead row, or partial
migration keeps the registry unavailable and requires operator investigation.

## Destructive authorization

Destructive migrations are denied by default. An operator must make the
authorization visible for the specific preparation run:

```ts
yield * prepare(registry, { allowDestructive: true });
```

The runtime checks every pending destructive migration before applying an
earlier additive migration in that run. CapsuleDB does not decide whether a
deployment is approved; the host supplies that policy.

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
database. A host may check a packed manifest/artifact in CI, but runtime
preparation remains authoritative at startup.

## Design-partner sketches

[`examples/samva-shared-client.ts`](../examples/samva-shared-client.ts) shows
how a host with a shared Effect Drizzle client can pass the underlying
host-owned SQL seam to CapsuleDB. [`examples/executor-plugin.ts`](../examples/executor-plugin.ts)
shows a boot-time plugin registry shape. Both are integration sketches for
discussion; neither Samva nor Executor adoption is claimed by this repository.
