import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import * as Capsule from "../../src/Capsule.ts";
import * as Migration from "../../src/Migration.ts";
import { profile as postgresProfile } from "../../src/Pg.ts";
import { BunSqliteProfile, type ProviderProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import { recordStatements } from "../fixtures/statements.ts";
import { withPostgres } from "../providers/postgres.ts";

class Notes extends Context.Service<
  Notes,
  {
    readonly write: (body: string) => Effect.Effect<void, SqlError>;
    readonly count: Effect.Effect<number, SqlError>;
    /** Two writes in one transaction; the second fails when `fail` is set. */
    readonly writeTwice: (body: string, fail: boolean) => Effect.Effect<void, SqlError | string>;
  }
>()("tests/lifecycle/FirstUseNotes") {}

const notes = Capsule.make({
  id: "first.use.notes",
  migrations: [
    Migration.make({
      id: 1,
      name: "create-notes",
      risk: "additive",
      steps: [
        Migration.sql({
          postgres: ['CREATE TABLE "first_use_notes" (body TEXT NOT NULL)'],
          sqlite: ['CREATE TABLE "first_use_notes" (body TEXT NOT NULL)'],
        }),
      ],
    }),
  ],
  layer: Layer.effect(
    Notes,
    Effect.gen(function* () {
      // Capsules capture the client at build, which is exactly what the gate
      // has to cover: every later statement flows through this value.
      const sql = (yield* Effect.service(SqlClient.SqlClient)).withoutTransforms();
      return {
        write: (body: string) => sql`INSERT INTO "first_use_notes" (body) VALUES (${body})`,
        count: sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM "first_use_notes"`.pipe(
          Effect.map((rows) => Number(rows[0]?.count ?? 0)),
        ),
        writeTwice: (body: string, fail: boolean) =>
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO "first_use_notes" (body) VALUES (${body})`;
              if (fail) return yield* Effect.fail("rolled back");
              yield* sql`INSERT INTO "first_use_notes" (body) VALUES (${body})`;
            }),
          ),
      };
    }),
  ),
});

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);

const firstUse = (provider: ProviderProfile, mode: "prepare" | "assert" = "prepare") =>
  Registry.layer({ provider, capsules: [notes], mode, readiness: "first-use" });

/** Build the layer, returning its context and what the build sent to the database. */
const build = (provider: ProviderProfile, mode: "prepare" | "assert" = "prepare") =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    return yield* recordStatements(Layer.buildWithScope(firstUse(provider, mode), scope));
  });

const lifecycle = (provider: ProviderProfile) =>
  Effect.gen(function* () {
    const [context, building] = yield* build(provider);
    assert.deepStrictEqual(building.statements, []);
    const service = Context.get(context, Notes);

    const [, first] = yield* recordStatements(service.write("first"));
    assert.strictEqual(first.spans("capsuledb.registry.prepare"), 1);

    const [count, second] = yield* recordStatements(service.count);
    assert.strictEqual(count, 1);
    assert.strictEqual(second.spans("capsuledb.registry.prepare"), 0);
    assert.strictEqual(second.statements.length, 1);

    // Transactions go through the host's own wrapper and still roll back.
    yield* service.writeTwice("pair", false);
    const failure = yield* service.writeTwice("half", true).pipe(Effect.flip);
    assert.strictEqual(failure, "rolled back");
    assert.strictEqual(yield* service.count, 3);
  });

describe("registry first-use readiness", () => {
  it.effect("builds without a statement and prepares on the first SQLite query", () =>
    withSqlite(lifecycle(BunSqliteProfile)),
  );

  it.effect(
    "builds without a statement and prepares on the first PostgreSQL query",
    () => withPostgres(() => Effect.scoped(lifecycle(postgresProfile))),
    60_000,
  );

  it.effect("runs one check for concurrent first uses", () =>
    withSqlite(
      Effect.gen(function* () {
        const [context] = yield* build(BunSqliteProfile);
        const service = Context.get(context, Notes);
        const [, recording] = yield* recordStatements(
          Effect.all(
            Array.from({ length: 8 }, (_, index) => service.write(`note-${index}`)),
            { concurrency: "unbounded" },
          ),
        );
        assert.strictEqual(recording.spans("capsuledb.registry.prepare"), 1);
        assert.strictEqual(yield* service.count, 8);
      }),
    ),
  );

  it.effect("fails a query until the database is prepared, then serves it", () =>
    withSqlite(
      Effect.gen(function* () {
        const [context, building] = yield* build(BunSqliteProfile, "assert");
        assert.deepStrictEqual(building.statements, []);
        const service = Context.get(context, Notes);

        const failure = yield* service.count.pipe(Effect.flip);
        assert.strictEqual(failure._tag, "SqlError");
        assert.strictEqual(failure.reason._tag, "UnknownError");
        const cause: unknown = failure.reason.cause;
        assert.strictEqual(
          typeof cause === "object" && cause !== null && "_tag" in cause ? cause._tag : undefined,
          "NotReady",
        );

        // The failure was not remembered: a deploy that prepares the database
        // makes the very next use succeed.
        yield* Registry.prepare({ provider: BunSqliteProfile, capsules: [notes] });
        const [count, recording] = yield* recordStatements(service.count);
        assert.strictEqual(count, 0);
        assert.strictEqual(recording.spans("capsuledb.registry.assert"), 1);
        assert.strictEqual(recording.statements.length, 2);
      }),
    ),
  );

  it.effect("still fails the build on an invalid composition", () =>
    withSqlite(
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const failure = yield* Layer.buildWithScope(
          Registry.layer({
            provider: BunSqliteProfile,
            capsules: [notes, notes],
            readiness: "first-use",
          }),
          scope,
        ).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "DuplicateCapsule");
      }),
    ),
  );

  it.effect("keeps the boot default: the build prepares", () =>
    withSqlite(
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const [, recording] = yield* recordStatements(
          Layer.buildWithScope(
            Registry.layer({ provider: BunSqliteProfile, capsules: [notes] }),
            scope,
          ),
        );
        assert.strictEqual(recording.spans("capsuledb.registry.prepare"), 1);
      }),
    ),
  );
});
