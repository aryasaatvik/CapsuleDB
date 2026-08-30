import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { makeCapsule } from "../../src/Capsule.ts";
import { makeMigration, sqlMigrationBody } from "../../src/Migration.ts";
import { Pg } from "../../src/Pg.ts";
import { makeRegistry, prepare, status } from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import { OneTimeTokens } from "../../examples/reference-token/OneTimeTokens.ts";
import { withPostgres } from "../providers/postgres.ts";

describe("reference token capsule over a host-supplied PostgreSQL client", () => {
  it.effect(
    "prepares, consumes once, and preserves the host client after service scope",
    () =>
      withPostgres((client) =>
        Effect.gen(function* () {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const capsule = yield* referenceTokenCapsule;
              const registry = yield* makeRegistry({
                provider: Pg.profile,
                capsules: [capsule],
              });
              const receipt = yield* prepare(registry);
              assert.strictEqual(receipt.provider, "postgres");
              assert.strictEqual((yield* status(registry))._tag, "Ready");

              const service = yield* Effect.service(OneTimeTokens);
              const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
              const consumed = yield* service.consume(issued.token);
              assert.strictEqual(consumed.token, issued.token);
              const replay = yield* service.consume(issued.token).pipe(Effect.flip);
              assert.strictEqual(replay._tag, "TokenAlreadyConsumed");
            }).pipe(Effect.provide(OneTimeTokens.layer)),
          );

          const rows = yield* client<{ readonly value: number }>`SELECT 2 AS value`;
          assert.deepStrictEqual(rows, [{ value: 2 }]);
        }),
      ),
    60_000,
  );

  it.effect(
    "rolls back a failed migration and keeps the client usable",
    () =>
      withPostgres((client) =>
        Effect.gen(function* () {
          const migration = yield* makeMigration({
            id: 1,
            name: "failing-postgres-migration",
            risk: "additive",
            providers: {
              Postgres: sqlMigrationBody("failing-postgres-migration", [
                'CREATE TABLE "postgres_failure_marker" (id TEXT PRIMARY KEY NOT NULL)',
                "THIS IS NOT VALID SQL",
              ]),
            },
          });
          const capsule = yield* makeCapsule({
            id: "postgres.failure",
            migrations: [migration],
            layer: Layer.empty,
          });
          const registry = yield* makeRegistry({
            provider: Pg.profile,
            capsules: [capsule],
          });
          const failure = yield* prepare(registry).pipe(Effect.flip);
          assert.strictEqual(failure._tag, "SqlError");

          assert.deepStrictEqual(
            yield* client<{ readonly to_regclass: string | null }>`SELECT to_regclass(
            'public.postgres_failure_marker')`,
            [{ to_regclass: null }],
          );
          assert.deepStrictEqual(yield* client<{ readonly value: number }>`SELECT 1 AS value`, [
            { value: 1 },
          ]);
        }),
      ),
    60_000,
  );

  it.effect(
    "serializes concurrent preparations with one database-wide history",
    () =>
      withPostgres((client) =>
        Effect.gen(function* () {
          const migration = yield* makeMigration({
            id: 1,
            name: "concurrent-postgres-migration",
            risk: "additive",
            providers: {
              Postgres: sqlMigrationBody(
                'CREATE TABLE "postgres_concurrent_probe" (id TEXT PRIMARY KEY NOT NULL)',
                ['CREATE TABLE "postgres_concurrent_probe" (id TEXT PRIMARY KEY NOT NULL)'],
              ),
            },
          });
          const capsule = yield* makeCapsule({
            id: "postgres.concurrent",
            migrations: [migration],
            layer: Layer.empty,
          });
          const registry = yield* makeRegistry({
            provider: Pg.profile,
            capsules: [capsule],
          });
          const receipts = yield* Effect.all([prepare(registry), prepare(registry)], {
            concurrency: "unbounded",
          });
          assert.deepStrictEqual(receipts[0], receipts[1]);
          assert.deepStrictEqual(
            yield* client<{ readonly count: number }>`SELECT COUNT(*)::integer AS count
            FROM "capsuledb_registry_ledger" WHERE capsule_id = 'postgres.concurrent'`,
            [{ count: 1 }],
          );
        }),
      ),
    60_000,
  );

  it.effect(
    "composes nested Effect SQL work through the same client transaction",
    () =>
      withPostgres((client) =>
        Effect.gen(function* () {
          yield* client.unsafe(
            'CREATE TABLE "postgres_composition_probe" (value INTEGER NOT NULL)',
          );
          const rows = yield* client.withTransaction(
            Effect.gen(function* () {
              yield* client`INSERT INTO "postgres_composition_probe" (value) VALUES (1)`;
              yield* Effect.exit(
                client.withTransaction(
                  Effect.gen(function* () {
                    yield* client`INSERT INTO "postgres_composition_probe" (value) VALUES (2)`;
                    return yield* Effect.fail("rollback nested savepoint");
                  }),
                ),
              );
              return yield* client<{ readonly value: number }>`SELECT value
              FROM "postgres_composition_probe" ORDER BY value`;
            }),
          );
          assert.deepStrictEqual(rows, [{ value: 1 }]);
        }),
      ),
    60_000,
  );
});
