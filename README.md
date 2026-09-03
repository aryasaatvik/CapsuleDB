# CapsuleDB

CapsuleDB is an Effect-native library for packages that own private database
tables, typed persistence operations, and forward migrations inside a host
application's database.

The host supplies the Effect SQL client and owns its connection lifecycle.
CapsuleDB keeps the capsule's physical schema and persistence implementation
private, while exposing explicit preparation and domain-oriented services.

## Quickstart

A capsule author declares its tables once and exports a `Capsule` constant:

```ts
import { Capsule, Migration, Schema } from "capsuledb";

const tokens = Schema.table("acme_tokens", {
  columns: {
    id: Schema.text(),
    owner_id: Schema.text(),
    consumed_at: Schema.timestamp({ nullable: true }),
  },
  primaryKey: ["id"],
  indexes: [{ columns: ["owner_id"] }],
});

export const capsule = Capsule.make({
  id: "acme.tokens",
  tables: [tokens],
  migrations: [
    Migration.make({
      id: 1,
      name: "create-tokens",
      risk: "additive",
      steps: [Migration.createTable(tokens)],
    }),
  ],
  layer: Tokens.layer,
});
```

CapsuleDB renders that declaration for PostgreSQL and SQLite (Bun SQLite,
libSQL, and D1). The host imports the value, chooses a provider profile, and
composes one Layer:

```ts
import { Pg, Registry } from "capsuledb";
import { capsule } from "./capsule.js";

export const CapsulesLive = Registry.layer({ provider: Pg.profile, capsules: [capsule] });
```

`Registry.layer` creates or checks CapsuleDB's ledger and metadata, applies
pending migrations, and then provides every registered capsule's service. It
does not open or close the host client: the layer still requires the host's
`SqlClient`. See the [capsule-author guide](docs/capsule-authors.md),
[host guide](docs/host-applications.md), and [migration runbook](docs/migrations-and-recovery.md)
for the complete contract.

A host that already owns a migration pipeline can take the SQL instead and
replace boot-time preparation with a readiness assertion:

```sh
capsuledb emit  --module ./capsule.ts --export capsule --dialect postgres --out ./drizzle
capsuledb check --module ./capsule.ts --export capsule --dialect postgres --out ./drizzle
```

```ts
Registry.layer({ provider: Pg.profile, capsules: [capsule], mode: "assert" });
```

The CLI also writes a deterministic manifest and, for D1, static SQL artifacts:

```sh
capsuledb manifest write --module ./capsule.ts --export capsule --output ./capsuledb.manifest.json
capsuledb d1 artifact --module ./capsule.ts --export capsule --output ./d1-artifacts
capsuledb d1 check --module ./capsule.ts --export capsule --artifact ./d1-artifacts --json
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
