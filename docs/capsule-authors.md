# Capsule-author contract

This guide describes the package-owned side of the CapsuleDB boundary. A
capsule author owns a logical ID, an append-only migration history, private
provider bodies, and an opaque Effect service layer. The host owns the database
client, its lifetime, and the decision to trust and compose a capsule.

## Define one capsule

Use the public constructors from `capsuledb` at the authoring boundary. IDs are
lowercase and stable. CapsuleDB derives the physical namespace from the ID;
authors do not accept a host-supplied table prefix or rename.

`Capsule.make` and `Migration.make` are pure: they return the value and throw
`CapsuleDefinitionError` on an invalid definition, so a capsule is an ordinary
module constant that a host can import without running an Effect first.

```ts
import { Context, Effect, Layer } from "effect";

import { Capsule, Migration } from "capsuledb";

class Greeting extends Context.Service<
  Greeting,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("example/Greeting") {}

const serviceLayer = Layer.succeed(Greeting, {
  greet: (name) => Effect.succeed(`hello ${name}`),
});

export const capsule = Capsule.make({
  id: "example.greeting",
  migrations: [
    Migration.make({
      id: 1,
      name: "create-greeting",
      risk: "additive",
      providers: {
        Postgres: Migration.sqlBody(['CREATE TABLE "greeting" (name TEXT NOT NULL)']),
      },
    }),
  ],
  layer: serviceLayer,
});
```

For static SQL bodies, `statements` is the exact sequence sent to the provider
and is the sole source of SQL integrity checksums. Transactional providers may
use an Effect body when the provider supports it; provide an immutable
author-assigned `revision` because executable functions are never placed in a
manifest and CapsuleDB cannot claim function equivalence. D1 accepts only
static SQL bodies.

## Migration rules

- Start at migration ID `1` and append contiguous IDs (`2`, `3`, ...).
- Keep an applied migration's ID, name, risk classification, provider body,
  and statements unchanged. A changed name or body is checksum drift, not an
  edit to apply in place.
- Mark an operation `destructive` when it removes or rewrites data/schema.
  The host must explicitly authorize pending destructive migrations for a
  preparation run.
- Keep physical tables and queries private to the capsule. CapsuleDB prevents
  namespace collisions but does not sandbox trusted package-authored SQL.
- Supply the provider implementation needed by the host. A missing provider
  body fails registry composition before database state is touched.

## Opaque service layer

Expose domain operations, not rows, tables, query builders, or a raw client.
The `layer` may require the host's `SqlClient` and may expose typed Effect
failures. The host composes that layer only after successful preparation.

```ts
const useGreeting = Effect.gen(function* () {
  const greeting = yield* Greeting;
  return yield* greeting.greet("CapsuleDB");
});
```

This keeps package implementation private while preserving normal Effect
service composition. Do not add a Promise facade or an ORM-specific service to
the CapsuleDB contract.

## Manifests and optional D1 artifacts

The CLI accepts an explicit module path and named export. It never scans
installed dependencies:

```sh
bun run capsuledb -- manifest write \
  --module ./src/capsules.ts \
  --export capsule \
  --output ./capsuledb.manifest.json
bun run capsuledb -- manifest check \
  --module ./src/capsules.ts \
  --export capsule \
  --manifest ./capsuledb.manifest.json \
  --json
```

For D1, `d1 artifact` projects only already-static D1 bodies into a manifest-
bound index and deterministic SQL files. `d1 check` rejects stale, edited,
missing, reordered, or unsupported projections. These files are optional
deployment aids; they do not execute migrations and do not replace the
host's canonical `Registry.layer` call.

## What the author does not own

The author does not open or close a host connection, choose the host's
provider, grant destructive authorization, or decide which capsules are loaded
in an application. Those are host-operator responsibilities described in the
[host guide](host-applications.md).
