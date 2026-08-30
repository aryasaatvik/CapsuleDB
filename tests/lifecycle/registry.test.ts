import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { makeCapsule } from "../../src/Capsule.ts";
import {
  DatabaseAhead,
  DestructiveMigrationUnauthorized,
  PartialMigration,
} from "../../src/Error.ts";
import { effectMigrationBody, makeMigration, sqlMigrationBody } from "../../src/Migration.ts";
import { BunSqliteProfile } from "../../src/Provider.ts";
import { makeRegistry, prepare, status } from "../../src/Registry.ts";
import { makeFixtureCapsule, makeFixtureMigration } from "../fixtures/migrations.ts";

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);

describe("registry migration lifecycle", () => {
  it.effect("refuses pending destructive migrations before applying earlier work", () =>
    withSqlite(
      Effect.gen(function* () {
        const first = yield* makeMigration({
          id: 1,
          name: "create-before-destructive",
          risk: "additive",
          providers: {
            Sqlite: sqlMigrationBody(
              'CREATE TABLE "lifecycle_before_destructive" (id TEXT PRIMARY KEY NOT NULL)',
              ['CREATE TABLE "lifecycle_before_destructive" (id TEXT PRIMARY KEY NOT NULL)'],
            ),
          },
        });
        const second = yield* makeMigration({
          id: 2,
          name: "drop-before-destructive",
          risk: "destructive",
          providers: {
            Sqlite: sqlMigrationBody('DROP TABLE "lifecycle_before_destructive"', [
              'DROP TABLE "lifecycle_before_destructive"',
            ]),
          },
        });
        const capsule = yield* makeCapsule({
          id: "lifecycle.destructive",
          migrations: [first, second],
          layer: Layer.empty,
        });
        const registry = yield* makeRegistry({ provider: BunSqliteProfile, capsules: [capsule] });
        const failure = yield* prepare(registry).pipe(Effect.flip);
        assert.strictEqual(
          failure._tag,
          new DestructiveMigrationUnauthorized({
            capsuleId: "lifecycle.destructive",
            migrationId: 2,
            name: "drop-before-destructive",
          })._tag,
        );

        const sql = yield* Effect.service(SqlClient.SqlClient);
        assert.deepStrictEqual(
          yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
            WHERE type = 'table' AND name = 'lifecycle_before_destructive'`,
          [],
        );

        yield* prepare(registry, { allowDestructive: true });
        assert.deepStrictEqual(
          yield* sql<{ readonly migration_id: number }>`SELECT migration_id
            FROM "capsuledb_registry_ledger" WHERE capsule_id = 'lifecycle.destructive'
            ORDER BY migration_id`,
          [{ migration_id: 1 }, { migration_id: 2 }],
        );
      }),
    ),
  );

  it.effect("fails closed when the database is ahead of the registered code", () =>
    withSqlite(
      Effect.gen(function* () {
        const migration = yield* makeFixtureMigration(
          1,
          "create-ahead-probe",
          'CREATE TABLE "lifecycle_ahead_probe" (id TEXT PRIMARY KEY NOT NULL)',
        );
        const capsule = yield* makeFixtureCapsule([migration], "lifecycle.ahead");
        const registry = yield* makeRegistry({ provider: BunSqliteProfile, capsules: [capsule] });
        yield* prepare(registry);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* sql`INSERT INTO ${sql("capsuledb_registry_ledger")}
          (capsule_id, migration_id, name, checksum, applied_at)
          VALUES ('lifecycle.ahead', 2, 'future-migration', ${"f".repeat(64)},
            '2099-01-01T00:00:00.000Z')`;

        const failure = yield* prepare(registry).pipe(Effect.flip);
        assert.strictEqual(
          failure._tag,
          new DatabaseAhead({
            capsuleId: "lifecycle.ahead",
            migrationId: 2,
            name: "future-migration",
          })._tag,
        );
      }),
    ),
  );

  it.effect("preserves removed capsule data and resumes on re-registration", () =>
    withSqlite(
      Effect.gen(function* () {
        const migration = yield* makeFixtureMigration(
          1,
          "create-removed-capsule",
          'CREATE TABLE "lifecycle_removed_capsule" (id TEXT PRIMARY KEY NOT NULL)',
        );
        const capsule = yield* makeFixtureCapsule([migration], "lifecycle.removed");
        const registry = yield* makeRegistry({ provider: BunSqliteProfile, capsules: [capsule] });
        yield* prepare(registry);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* sql.unsafe("INSERT INTO \"lifecycle_removed_capsule\" (id) VALUES ('retained')");

        const emptyRegistry = yield* makeRegistry({ provider: BunSqliteProfile, capsules: [] });
        yield* prepare(emptyRegistry);
        assert.deepStrictEqual(
          yield* sql<{ readonly id: string }>`SELECT id FROM "lifecycle_removed_capsule"`,
          [{ id: "retained" }],
        );

        yield* prepare(registry);
        assert.deepStrictEqual(
          yield* sql<{ readonly id: string }>`SELECT id FROM "lifecycle_removed_capsule"`,
          [{ id: "retained" }],
        );
      }),
    ),
  );

  it.effect("reports a partial state when readiness metadata claims completion", () =>
    withSqlite(
      Effect.gen(function* () {
        const migration = yield* makeFixtureMigration(
          1,
          "create-partial-probe",
          'CREATE TABLE "lifecycle_partial_probe" (id TEXT PRIMARY KEY NOT NULL)',
        );
        const capsule = yield* makeFixtureCapsule([migration], "lifecycle.partial");
        const registry = yield* makeRegistry({ provider: BunSqliteProfile, capsules: [capsule] });
        yield* prepare(registry);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* sql.unsafe(
          "DELETE FROM \"capsuledb_registry_ledger\" WHERE capsule_id = 'lifecycle.partial'",
        );

        const failure = yield* prepare(registry).pipe(Effect.flip);
        assert.strictEqual(
          failure._tag,
          new PartialMigration({
            capsuleId: "lifecycle.partial",
            migrationId: 1,
            reason:
              "readiness metadata claims the registry is complete but its ledger is incomplete",
          })._tag,
        );
        assert.strictEqual((yield* status(registry))._tag, "Stale");
      }),
    ),
  );

  it.effect("serializes concurrent preparation to one exact history", () =>
    withSqlite(
      Effect.gen(function* () {
        const migration = yield* makeFixtureMigration(
          1,
          "create-concurrent-probe",
          'CREATE TABLE "lifecycle_concurrent_probe" (id TEXT PRIMARY KEY NOT NULL)',
        );
        const capsule = yield* makeFixtureCapsule([migration], "lifecycle.concurrent");
        const registry = yield* makeRegistry({ provider: BunSqliteProfile, capsules: [capsule] });
        const receipts = yield* Effect.all([prepare(registry), prepare(registry)], {
          concurrency: "unbounded",
        });
        assert.deepStrictEqual(receipts[0], receipts[1]);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        assert.deepStrictEqual(
          yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
            FROM "capsuledb_registry_ledger" WHERE capsule_id = 'lifecycle.concurrent'`,
          [{ count: 1 }],
        );
      }),
    ),
  );

  it.effect("rolls back an interrupted transactional migration", () =>
    withSqlite(
      Effect.gen(function* () {
        const migration = yield* makeMigration({
          id: 1,
          name: "interruptible-migration",
          risk: "additive",
          providers: {
            Sqlite: effectMigrationBody<SqlError, SqlClient.SqlClient>(
              "CREATE TABLE lifecycle_interruptible",
              Effect.gen(function* () {
                const sql = yield* Effect.service(SqlClient.SqlClient);
                yield* sql.unsafe(
                  'CREATE TABLE "lifecycle_interruptible" (id TEXT PRIMARY KEY NOT NULL)',
                );
                yield* Effect.sleep("10 seconds");
              }),
            ),
          },
        });
        const capsule = yield* makeCapsule({
          id: "lifecycle.interruptible",
          migrations: [migration],
          layer: Layer.empty,
        });
        const registry = yield* makeRegistry({ provider: BunSqliteProfile, capsules: [capsule] });
        const fiber = yield* prepare(registry).pipe(Effect.forkScoped);
        yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
        yield* Fiber.interrupt(fiber);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        assert.deepStrictEqual(
          yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
            WHERE type = 'table' AND name = 'lifecycle_interruptible'`,
          [],
        );
        assert.deepStrictEqual(
          yield* sql<{ readonly migration_id: number }>`SELECT migration_id
            FROM "capsuledb_registry_ledger" WHERE capsule_id = 'lifecycle.interruptible'`,
          [],
        );
      }),
    ),
  );
});
