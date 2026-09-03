import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Capsule from "../../src/Capsule.ts";
import { profile as d1Profile } from "../../src/D1.ts";
import { LedgerConflict } from "../../src/Error.ts";
import * as Migration from "../../src/Migration.ts";
import * as Registry from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import {
  OneTimeTokens,
  layer as tokenLayer,
} from "../../examples/reference-token/OneTimeTokens.ts";
import { withD1 } from "./d1.ts";

const limitedD1 = (limits: {
  readonly maxStatements?: number;
  readonly maxSqlStatementBytes?: number;
  readonly maxBoundParameters?: number;
}) => ({
  ...d1Profile,
  capabilities: { ...d1Profile.capabilities, ...limits },
});

describe("D1 atomic migration runner", () => {
  it.effect(
    "preflights all pending migrations before any claim or user DDL",
    () =>
      withD1((client) =>
        Effect.scoped(
          Effect.gen(function* () {
            const first = Migration.make({
              id: 1,
              name: "first-valid-migration",
              risk: "additive",
              providers: {
                D1: Migration.sqlBody([
                  'CREATE TABLE "d1_preflight_first" (id TEXT PRIMARY KEY NOT NULL)',
                ]),
              },
            });
            const second = Migration.make({
              id: 2,
              name: "second-over-limit-migration",
              risk: "additive",
              providers: {
                D1: Migration.sqlBody([
                  'CREATE TABLE "d1_preflight_second_a" (id TEXT PRIMARY KEY NOT NULL)',
                  'CREATE TABLE "d1_preflight_second_b" (id TEXT PRIMARY KEY NOT NULL)',
                ]),
              },
            });
            const capsule = Capsule.make({
              id: "d1.preflight",
              migrations: [first, second],
              layer: Layer.empty,
            });
            const registry = {
              provider: d1Profile,
              capsules: [capsule],
            };
            const failure = yield* Registry.prepare(registry).pipe(Effect.flip);
            assert.strictEqual(failure._tag, "InvalidDefinition");
            assert.deepStrictEqual(
              yield* client<{ readonly name: string }>`SELECT name FROM sqlite_master
                WHERE type = 'table' AND name LIKE 'd1_preflight_%' ORDER BY name`,
              [],
            );
            assert.deepStrictEqual(
              yield* client<{ readonly count: number }>`SELECT COUNT(*) AS count
                FROM "capsuledb_registry_ledger" WHERE capsule_id = 'd1.preflight'`,
              [{ count: 0 }],
            );
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "rolls back a claim and earlier DDL when a batch statement fails",
    () =>
      withD1((client) =>
        Effect.scoped(
          Effect.gen(function* () {
            const migration = Migration.make({
              id: 1,
              name: "failing-d1-migration",
              risk: "additive",
              providers: {
                D1: Migration.sqlBody([
                  'CREATE TABLE "d1_failure_marker" (id TEXT PRIMARY KEY NOT NULL)',
                  "THIS IS NOT VALID SQL",
                ]),
              },
            });
            const capsule = Capsule.make({
              id: "d1.failure",
              migrations: [migration],
              layer: Layer.empty,
            });
            const registry = {
              provider: limitedD1({ maxStatements: 3 }),
              capsules: [capsule],
            };
            const failure = yield* Registry.prepare(registry).pipe(Effect.flip);
            assert.strictEqual(failure._tag, "SqlError");
            assert.deepStrictEqual(
              yield* client<{ readonly name: string }>`SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'd1_failure_marker'`,
              [],
            );
            assert.deepStrictEqual(
              yield* client<{ readonly count: number }>`SELECT COUNT(*) AS count
                FROM "capsuledb_registry_ledger" WHERE capsule_id = 'd1.failure'`,
              [{ count: 0 }],
            );
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "converges concurrent exact claims after a ledger reread",
    () =>
      withD1((client) =>
        Effect.scoped(
          Effect.gen(function* () {
            const migration = Migration.make({
              id: 1,
              name: "concurrent-d1-migration",
              risk: "additive",
              providers: {
                D1: Migration.sqlBody([
                  'CREATE TABLE "d1_concurrent_marker" (id TEXT PRIMARY KEY NOT NULL)',
                ]),
              },
            });
            const capsule = Capsule.make({
              id: "d1.concurrent",
              migrations: [migration],
              layer: Layer.empty,
            });
            const registry = {
              provider: d1Profile,
              capsules: [capsule],
            };
            const receipts = yield* Effect.all(
              [Registry.prepare(registry), Registry.prepare(registry)],
              {
                concurrency: "unbounded",
              },
            );
            assert.deepStrictEqual(receipts[0], receipts[1]);
            assert.deepStrictEqual(
              yield* client<{ readonly count: number }>`SELECT COUNT(*) AS count
                FROM "capsuledb_registry_ledger" WHERE capsule_id = 'd1.concurrent'`,
              [{ count: 1 }],
            );
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "does not converge a D1 conflict when the ledger name diverges",
    () =>
      withD1((client) =>
        Effect.scoped(
          Effect.gen(function* () {
            const migration = Migration.make({
              id: 1,
              name: "d1-name-conflict",
              risk: "additive",
              providers: {
                D1: Migration.sqlBody([
                  'CREATE TABLE "d1_name_conflict" (id TEXT PRIMARY KEY NOT NULL)',
                ]),
              },
            });
            const capsule = Capsule.make({
              id: "d1.name-conflict",
              migrations: [migration],
              layer: Layer.empty,
            });
            const registry = {
              provider: d1Profile,
              capsules: [capsule],
            };
            const conflictClient = new Proxy(client, {
              get(target, property, receiver) {
                if (property !== "batch") return Reflect.get(target, property, receiver);
                return (statements: Parameters<typeof target.batch>[0]) =>
                  target.batch(statements).pipe(
                    Effect.flatMap(() =>
                      target.unsafe(`UPDATE "capsuledb_registry_ledger"
                        SET name = 'different-d1-name'
                        WHERE capsule_id = 'd1.name-conflict' AND migration_id = 1`),
                    ),
                    Effect.flatMap(() => target.unsafe("THIS IS NOT VALID SQL")),
                  );
              },
            }) as unknown as SqlClient.SqlClient;
            const failure = yield* Registry.prepare(registry).pipe(
              Effect.provideService(SqlClient.SqlClient, conflictClient),
              Effect.flip,
            );
            assert.strictEqual(
              failure._tag,
              new LedgerConflict({
                capsuleId: "d1.name-conflict",
                migrationId: 1,
                expected: "ignored",
                actual: "ignored",
              })._tag,
            );
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "writes one audit row for concurrent atomic consumes",
    () =>
      withD1((client) =>
        Effect.scoped(
          Effect.gen(function* () {
            const capsule = referenceTokenCapsule;
            const registry = {
              provider: d1Profile,
              capsules: [capsule],
            };
            yield* Registry.prepare(registry);
            const service = yield* Effect.service(OneTimeTokens);
            const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
            const attempts = yield* Effect.all(
              [1, 2].map(() =>
                service.consume(issued.token).pipe(
                  Effect.match({
                    onFailure: (error) => ({ _tag: "Failure" as const, error }),
                    onSuccess: (receipt) => ({ _tag: "Success" as const, receipt }),
                  }),
                ),
              ),
              { concurrency: "unbounded" },
            );
            assert.strictEqual(attempts.filter((attempt) => attempt._tag === "Success").length, 1);
            assert.strictEqual(attempts.filter((attempt) => attempt._tag === "Failure").length, 1);
            const failure = attempts.find((attempt) => attempt._tag === "Failure");
            assert.strictEqual(failure?.error._tag, "TokenAlreadyConsumed");
            assert.deepStrictEqual(
              yield* client<{ readonly count: number }>`SELECT COUNT(*) AS count
                FROM "capsule_reference_2e_token_audit"`,
              [{ count: 1 }],
            );
          }).pipe(Effect.provide(tokenLayer)),
        ),
      ),
    60_000,
  );

  it.effect(
    "rejects oversized static SQL before invoking batch",
    () =>
      withD1((client) =>
        Effect.scoped(
          Effect.gen(function* () {
            const migration = Migration.make({
              id: 1,
              name: "oversized-d1-migration",
              risk: "additive",
              providers: {
                D1: Migration.sqlBody(['CREATE TABLE "d1_oversized_marker" (value TEXT NOT NULL)']),
              },
            });
            const capsule = Capsule.make({
              id: "d1.oversized",
              migrations: [migration],
              layer: Layer.empty,
            });
            const registry = {
              provider: limitedD1({ maxSqlStatementBytes: 32 }),
              capsules: [capsule],
            };
            const failure = yield* Registry.prepare(registry).pipe(Effect.flip);
            assert.strictEqual(failure._tag, "InvalidDefinition");
            assert.deepStrictEqual(
              yield* client<{ readonly name: string }>`SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'd1_oversized_marker'`,
              [],
            );
          }),
        ),
      ),
    60_000,
  );

  it.effect("rejects dynamic Effect migration bodies at the D1 boundary", () =>
    withD1(() =>
      Effect.gen(function* () {
        const migration = Migration.make({
          id: 1,
          name: "dynamic-d1-migration",
          risk: "additive",
          providers: {
            D1: Migration.effectBody("dynamic-d1-migration", Effect.void),
          },
        });
        const capsule = Capsule.make({
          id: "d1.dynamic",
          migrations: [migration],
          layer: Layer.empty,
        });
        const failure = yield* Registry.manifest({
          provider: d1Profile,
          capsules: [capsule],
        }).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "ProviderMismatch");
      }),
    ),
  );
});
