import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import * as Capsule from "../../src/Capsule.ts";
import * as Migration from "../../src/Migration.ts";
import { BunSqliteProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";

const NOTES_TABLE = "capsule_layer_notes";
const AUDIT_TABLE = "capsule_layer_audit";

class Notes extends Context.Service<
  Notes,
  { readonly write: (body: string) => Effect.Effect<void, SqlError> }
>()("tests/lifecycle/Notes") {}

class Audit extends Context.Service<Audit, { readonly count: Effect.Effect<number, SqlError> }>()(
  "tests/lifecycle/Audit",
) {}

const notes = Capsule.make({
  id: "layer.notes",
  migrations: [
    Migration.make({
      id: 1,
      name: "create-notes",
      risk: "additive",
      providers: {
        Sqlite: Migration.sqlBody([`CREATE TABLE "${NOTES_TABLE}" (body TEXT NOT NULL)`]),
      },
    }),
  ],
  layer: Layer.effect(
    Notes,
    Effect.map(Effect.service(SqlClient.SqlClient), (sql) => ({
      write: (body: string) => sql`INSERT INTO ${sql(NOTES_TABLE)} (body) VALUES (${body})`,
    })),
  ),
});

const audit = Capsule.make({
  id: "layer.audit",
  migrations: [
    Migration.make({
      id: 1,
      name: "create-audit",
      risk: "additive",
      providers: {
        Sqlite: Migration.sqlBody([`CREATE TABLE "${AUDIT_TABLE}" (entries INTEGER NOT NULL)`]),
      },
    }),
  ],
  layer: Layer.effect(
    Audit,
    Effect.map(Effect.service(SqlClient.SqlClient), (sql) => ({
      count: sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM ${sql(AUDIT_TABLE)}`.pipe(
        Effect.map((rows) => Number(rows[0]?.count ?? 0)),
      ),
    })),
  ),
});

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);

describe("registry layer", () => {
  it.effect("prepares and serves two capsules through one Layer", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsules = Registry.layer({
          provider: BunSqliteProfile,
          capsules: [notes, audit],
        });

        yield* Effect.gen(function* () {
          // Both capsule services resolve from the same Layer, and both of
          // their tables exist because preparation was built first.
          yield* (yield* Effect.service(Notes)).write("first");
          assert.strictEqual(yield* (yield* Effect.service(Audit)).count, 0);
        }).pipe(Effect.provide(capsules));

        const sql = yield* Effect.service(SqlClient.SqlClient);
        assert.deepStrictEqual(
          yield* sql<{ readonly body: string }>`SELECT body FROM ${sql(NOTES_TABLE)}`,
          [{ body: "first" }],
        );
        assert.deepStrictEqual(
          yield* sql<{ readonly capsule_id: string }>`SELECT DISTINCT capsule_id
            FROM "capsuledb_registry_ledger" ORDER BY capsule_id`,
          [{ capsule_id: "layer.audit" }, { capsule_id: "layer.notes" }],
        );
      }),
    ),
  );

  it.effect("fails the Layer when a capsule's migration cannot be applied", () =>
    withSqlite(
      Effect.gen(function* () {
        const broken = Capsule.make({
          id: "layer.broken",
          migrations: [
            Migration.make({
              id: 1,
              name: "invalid-ddl",
              risk: "additive",
              providers: { Sqlite: Migration.sqlBody(["THIS IS NOT VALID SQL"]) },
            }),
          ],
          layer: Layer.succeed(Notes, { write: () => Effect.void }),
        });

        const failure = yield* Effect.service(Notes).pipe(
          Effect.provide(Registry.layer({ provider: BunSqliteProfile, capsules: [broken] })),
          Effect.flip,
        );
        assert.strictEqual(failure._tag, "SqlError");
      }),
    ),
  );
});
