import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { profile as postgresProfile } from "../../src/Pg.ts";
import { BunSqliteProfile, type ProviderProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import { makeFixtureCapsule, makeFixtureMigration } from "../fixtures/migrations.ts";
import { recordStatements } from "../fixtures/statements.ts";
import { withPostgres } from "../providers/postgres.ts";

const capsules = [
  makeFixtureCapsule(
    [
      makeFixtureMigration(1, "create-trips", 'CREATE TABLE "round_trips" (id TEXT PRIMARY KEY)'),
      makeFixtureMigration(2, "index-trips", 'CREATE INDEX "round_trips_id" ON "round_trips" (id)'),
    ],
    "round.trips",
  ),
  makeFixtureCapsule(
    [makeFixtureMigration(1, "create-legs", 'CREATE TABLE "round_legs" (id TEXT PRIMARY KEY)')],
    "round.legs",
  ),
];

/**
 * A current registry is the boot path of every serverless cold start, so its
 * cost is the contract: one statement, no transaction, no lock.
 */
const steadyState = (provider: ProviderProfile) =>
  Effect.gen(function* () {
    const options = { provider, capsules };
    yield* Registry.prepare(options);

    const [prepared, prepare] = yield* recordStatements(Registry.prepare(options));
    assert.strictEqual(prepared._tag, "Ready");
    assert.strictEqual(prepare.statements.length, 1);
    assert.strictEqual(prepare.transactions, 0);

    const [asserted, assertion] = yield* recordStatements(Registry.assert(options));
    assert.strictEqual(asserted.fingerprint, prepared.fingerprint);
    assert.strictEqual(assertion.statements.length, 1);
    assert.strictEqual(assertion.transactions, 0);

    const [readiness, status] = yield* recordStatements(Registry.status(options));
    assert.strictEqual(readiness._tag, "Ready");
    assert.strictEqual(status.statements.length, 1);
  });

describe("registry round trips", () => {
  it.effect("answers a current SQLite registry in one statement", () =>
    steadyState(BunSqliteProfile).pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  );

  it.effect(
    "answers a current PostgreSQL registry in one statement",
    () => withPostgres(() => steadyState(postgresProfile)),
    60_000,
  );

  it.effect("reads an empty database as Pending without creating tables", () =>
    Effect.gen(function* () {
      const readiness = yield* Registry.status({ provider: BunSqliteProfile, capsules });
      assert.strictEqual(readiness._tag, "Pending");
      if (readiness._tag === "Pending") assert.strictEqual(readiness.pending.length, 3);
      const sql = yield* Effect.service(SqlClient.SqlClient);
      assert.deepStrictEqual(yield* sql`SELECT name FROM sqlite_master WHERE type = 'table'`, []);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped),
  );

  it.effect(
    "reads an empty PostgreSQL database as Pending inside a caller's transaction",
    () =>
      withPostgres((client) =>
        Effect.gen(function* () {
          // A failed statement aborts a PostgreSQL transaction, so the missing
          // tables must not poison the transaction the caller is still using.
          const readiness = yield* client.withTransaction(
            Effect.gen(function* () {
              const observed = yield* Registry.status({ provider: postgresProfile, capsules });
              yield* client`SELECT 1`;
              return observed;
            }),
          );
          assert.strictEqual(readiness._tag, "Pending");
        }),
      ),
    60_000,
  );

  it.effect("takes the locked path again once a new migration is registered", () =>
    Effect.gen(function* () {
      const [first, ...rest] = capsules;
      if (first === undefined) return;
      yield* Registry.prepare({ provider: BunSqliteProfile, capsules: [first] });
      const [, recording] = yield* recordStatements(
        Registry.prepare({ provider: BunSqliteProfile, capsules: [first, ...rest] }),
      );
      assert.isAbove(recording.statements.length, 1);
      assert.isAbove(recording.transactions, 0);
      const sql = yield* Effect.service(SqlClient.SqlClient);
      assert.deepStrictEqual(yield* sql`SELECT name FROM sqlite_master WHERE name = 'round_legs'`, [
        { name: "round_legs" },
      ]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped),
  );
});
