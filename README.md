# CapsuleDB

CapsuleDB is an Effect-native library for packages that own private database
tables, typed persistence operations, and forward migrations inside a host
application's database.

The host supplies the Effect SQL client and owns its connection lifecycle.
CapsuleDB keeps the capsule's physical schema and persistence implementation
private, while exposing explicit preparation and domain-oriented services.

## Quickstart

Capsule authors export a `Capsule` value. The host imports that value, chooses a
provider profile, and supplies its already-owned `SqlClient` to preparation:

```ts
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { Pg, makeRegistry, prepare } from "capsuledb";
import { capsule } from "./capsule.js";

const boot = Effect.gen(function* () {
  const registry = yield* makeRegistry({ provider: Pg.profile, capsules: [capsule] });
  const receipt = yield* prepare(registry);
  return receipt;
}).pipe(Effect.provideService(SqlClient.SqlClient, hostOwnedSqlClient));
```

`prepare` creates or checks CapsuleDB's ledger and metadata, applies pending
migrations, and returns a readiness receipt. It does not open or close the
host client. Domain services are provided by the capsule's Effect `Layer` after
preparation. See the [capsule-author guide](docs/capsule-authors.md),
[host guide](docs/host-applications.md), and [migration runbook](docs/migrations-and-recovery.md)
for the complete contract.

For static D1 bodies, the optional CLI can persist a manifest and project SQL
files. These files are deployment aids only; runtime preparation remains the
source of truth:

```sh
bun run capsuledb -- manifest write --module ./capsule.ts --export capsule --output ./capsuledb.manifest.json
bun run capsuledb -- d1 artifact --module ./capsule.ts --export capsule --output ./d1-artifacts
bun run capsuledb -- d1 check --module ./capsule.ts --export capsule --artifact ./d1-artifacts --json
```

## Status

The package is in active pre-1.0 development. The public contract is Effect 4
and may change directly until a stable release is declared.

## Development

Use Bun 1.4 and Node.js 24.10 or newer:

```sh
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
```

Documentation and example checks are also available:

```sh
bun run docs:check
bun run typecheck:examples
```

## Scope

CapsuleDB is not an ORM. It does not expose package-owned tables, rows, query
builders, raw driver ownership, or a Promise facade as its canonical API. It
prevents capsule namespace collisions and keeps package-owned persistence
opaque, but v0.1 does not sandbox trusted package-authored SQL or service code;
package authors remain responsible for avoiding cross-capsule physical
composition.

CapsuleDB is a library boundary, not a provider deployment service. It does
not invoke Wrangler, configure D1 accounts, infer installed packages, or
silently discover capsules. A host explicitly composes the capsules it trusts.

## Guides

- [Capsule authors](docs/capsule-authors.md) — IDs, private migrations, services, and provider bodies.
- [Host applications](docs/host-applications.md) — client ownership, preparation, readiness, and authorization.
- [Providers](docs/providers.md) — capability matrix and D1's bounded atomic-batch contract.
- [Migrations and recovery](docs/migrations-and-recovery.md) — append-only changes and failure recovery.
- [Architecture ADR](docs/adr/0001-effect-native-capsule-runtime.md) — durable design rationale.

## License

MIT
