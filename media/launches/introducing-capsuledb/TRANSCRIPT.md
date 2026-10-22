# Introducing CapsuleDB: transcript

Text alternative for [`capsuledb-launch.mp4`](../../exports/capsuledb-launch.mp4), a silent
60-second film. Each section lists the on-screen text in order and describes what the motion shows.

## 0:00 For package authors

Your package needs tables. The app owns the database.

Bring the tables. Borrow the client.

## 0:07 CapsuleDB

The capsule mark closes: an ink half for the host, a vermilion half for the package.

CapsuleDB. Ship persistence with your package. Use the database the app already owns.

Effect-native. Open source, MIT. PostgreSQL, SQLite, libSQL, D1.

## 0:12 The capsule

A capsule is one value. Tables, append-only migrations, and a typed Effect service, exported as
one constant.

The code from `examples/reference-token/Capsule.ts`:

```ts
export const capsule = Capsule.make({
  id: "reference.tokens",
  tables: [tokens, tokenAudit],
  migrations: [
    Migration.make({
      id: 1,
      name: "create-tokens",
      risk: "additive",
      steps: [Migration.createTable(tokens)],
    }),
    Migration.make({
      id: 2,
      name: "add-token-audit",
      risk: "additive",
      steps: [Migration.createTable(tokenAudit)],
    }),
  ],
  layer: tokenLayer,
});
```

Each part highlights while a capsule diagram fills the matching compartment:

- Tables: declared once with `Schema.table`. Rendered for PostgreSQL and SQLite.
- Migrations: append-only and numbered from 1. Editing applied history reads as drift.
- Service: an Effect Layer that provides a typed domain service, not rows.
- Identity: `reference.tokens` derives the namespace `capsule_reference_2e_tokens`.

## 0:24 The host

The host composes what it trusts. The code from `docs/host-applications.md`:

```ts
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

A host application frame holds `Registry.layer` with the `reference.tokens` capsule (explicit, no
discovery) and the `SqlClient`, opened, shared, and closed by the host. The host database holds the
app's own tables, `capsule_reference_2e_tokens`, `capsule_reference_2e_token_audit`,
`capsuledb_registry_ledger`, and `capsuledb_registry_metadata`.

Capsules are trusted package code. CapsuleDB prevents namespace collisions; it does not sandbox
their SQL.

## 0:36 Preparation

Prepared before any service is provided. A marker visits five steps:

1. Read: metadata and ledger, in one statement.
2. Pending: `1 create-tokens`, `2 add-token-audit`.
3. Apply: each migration commits with its ledger row. PostgreSQL: under an advisory lock.
4. Ready: fingerprint, provider, capsules: 1.
5. Provide: `OneTimeTokens`. Only now does the service exist.

Already current? Ready from the first read, with no lock and no DDL. Drift or a failed migration
fails the layer with a typed error.

## 0:48 The service

Call the domain. The tables stay private. Illustrative calls against
`examples/reference-token/OneTimeTokens.ts`, each with its typed result:

| Call                                                | Result                 |
| --------------------------------------------------- | ---------------------- |
| `const tokens = yield* OneTimeTokens;`              |                        |
| `const { token } = yield* tokens.issue(expiresAt);` | `IssuedToken`          |
| `yield* tokens.get(token);`                         | `Pending`              |
| `yield* tokens.consume(token);`                     | `AuditReceipt`         |
| `yield* tokens.consume(token);`                     | `TokenAlreadyConsumed` |

Operations: `issue(expiresAt)`, `get(token)`, `consume(token)`, `revoke(token)`, on
`OneTimeTokensService`.

## 0:55 Get started

CapsuleDB. `bun add capsuledb`. github.com/aryasaatvik/CapsuleDB. MIT license. Effect 4. Pre-1.0.
