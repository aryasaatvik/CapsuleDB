# Capsule-author contract

This guide describes the package-owned side of the CapsuleDB boundary. A
capsule author owns a logical ID, an append-only migration history, private
provider bodies, and an opaque Effect service layer. The host owns the database
client, its lifetime, and the decision to trust and compose a capsule.

## Define one capsule

Use the public constructors from `capsuledb` at the authoring boundary. IDs are
lowercase and stable. CapsuleDB derives the physical namespace from the ID;
authors do not accept a host-supplied table prefix or rename.

`Schema.table`, `Capsule.make`, and `Migration.make` are pure: they return the
value and throw `CapsuleDefinitionError` on an invalid definition, so a capsule
is an ordinary module constant that a host can import without running an Effect
first. Declare a table once; CapsuleDB renders the DDL for each dialect.

```ts
import { Context, Effect, Layer } from "effect";

import { Capsule, Migration, Schema } from "capsuledb";

const greeting = Schema.table("greeting", {
  columns: {
    name: Schema.text(),
    greeted_at: Schema.timestamp({ default: { sql: "CURRENT_TIMESTAMP" } }),
  },
  primaryKey: ["name"],
  indexes: [{ columns: ["greeted_at"] }],
});

class Greeting extends Context.Service<
  Greeting,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("example/Greeting") {}

const serviceLayer = Layer.succeed(Greeting, {
  greet: (name) => Effect.succeed(`hello ${name}`),
});

export const capsule = Capsule.make({
  id: "example.greeting",
  tables: [greeting],
  migrations: [
    Migration.make({
      id: 1,
      name: "create-greeting",
      risk: "additive",
      steps: [Migration.createTable(greeting)],
    }),
  ],
  layer: serviceLayer,
});
```

`Schema.Row<typeof greeting>` is the row type for the capsule's own queries;
`capsule.tables` is the declared list a host tool can read without parsing SQL.

## Columns and dialects

| Column               | PostgreSQL    | SQLite    |
| -------------------- | ------------- | --------- |
| `Schema.text()`      | `TEXT`        | `TEXT`    |
| `Schema.integer()`   | `INTEGER`     | `INTEGER` |
| `Schema.bigint()`    | `BIGINT`      | `INTEGER` |
| `Schema.boolean()`   | `BOOLEAN`     | `INTEGER` |
| `Schema.timestamp()` | `TIMESTAMPTZ` | `TEXT`    |
| `Schema.json()`      | `JSONB`       | `TEXT`    |

`sqlite` covers Bun SQLite, libSQL, and Cloudflare D1. Columns are `NOT NULL`
unless declared `{ nullable: true }`, defaults accept a literal or a raw
`{ sql }` expression, and rendering is deterministic: columns in declaration
order, then the primary key, unique constraints, checks, and finally one
`CREATE INDEX` per declared index.

## Migration steps

| Step                                       | Renders                      |
| ------------------------------------------ | ---------------------------- |
| `Migration.createTable(table)`             | `CREATE TABLE` plus indexes  |
| `Migration.addColumn(table, name, column)` | `ALTER TABLE ... ADD COLUMN` |
| `Migration.createIndex(table, index)`      | `CREATE INDEX`               |
| `Migration.dropTable(table)`               | `DROP TABLE`                 |
| `Migration.sql({ postgres, sqlite })`      | the statements you wrote     |
| `Migration.effect(revision, program)`      | nothing; runs the program    |

One migration may mix all of them. A `Migration.sql` step limits the migration
to the dialects it declares a body for, and a migration that no dialect can
apply in full is rejected at definition time.

Rendered statements are the exact sequence sent to the provider and are the sole
source of SQL integrity checksums. Transactional providers may use an Effect
step; provide an immutable author-assigned `revision`, because executable
functions are never placed in a manifest and CapsuleDB cannot claim function
equivalence. D1 accepts only SQL-producing steps.

Table, column, index, and constraint names are restricted to ordinary SQL
identifiers so CapsuleDB can quote them safely. Expressions you supply —
a `check.sql`, an index `where`, a `{ sql }` default, a `Migration.sql` body —
are rendered verbatim and remain your responsibility; CapsuleDB does not
sandbox author SQL.

## Migration rules

- Start at migration ID `1` and append contiguous IDs (`2`, `3`, ...).
- Keep an applied migration's ID, name, risk classification, and steps
  unchanged. A changed name or a change that alters the rendered SQL is
  checksum drift, not an edit to apply in place.
- Mark an operation `destructive` when it removes or rewrites data/schema.
  The host must explicitly authorize pending destructive migrations for a
  preparation run.
- Keep physical tables and queries private to the capsule. CapsuleDB prevents
  namespace collisions but does not sandbox trusted package-authored SQL.
- Supply a body for the dialect the host runs. A migration with no body for the
  active dialect fails registry composition before database state is touched.

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

## Test your capsule with the exported kit

`capsuledb/Testing` ships the same provider-neutral conformance suite this
repository runs, plus a throwaway SQLite client, so a capsule author does not
have to bring testcontainers to get a first signal:

```ts
import { Effect } from "effect";
import { runConformance, withSqlite } from "capsuledb/Testing";

import { capsule } from "./capsule.js";

test("capsule conforms", () => Effect.runPromise(withSqlite(runConformance(capsule))));
```

`conformance(capsule, profile?)` returns the cases as plain Effects if you would
rather register one test per case, and it accepts any provider profile when you
do have a real client. The cases migrate and read the database they are given,
so point them at a scratch database. `withSqlite` uses `@effect/sql-sqlite-bun`
under Bun and `@effect/sql-libsql` elsewhere; both are optional peers imported
only when the helper runs.

## What the author does not own

The author does not open or close a host connection, choose the host's
provider, grant destructive authorization, or decide which capsules are loaded
in an application. Those are host-operator responsibilities described in the
[host guide](host-applications.md).
