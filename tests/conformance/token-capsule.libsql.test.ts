import { createClient, type Client } from "@libsql/client";
import { LibsqlClient } from "@effect/sql-libsql";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeCapsule } from "../../src/Capsule.ts";
import { makeMigration, sqlMigrationBody } from "../../src/Migration.ts";
import { profile as libsqlProfile } from "../../src/Libsql.ts";
import { makeRegistry, prepare, status } from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import {
  OneTimeTokens,
  layer as tokenLayer,
} from "../../examples/reference-token/OneTimeTokens.ts";

const withHostClient = <A, E, R>(
  effect: (client: Client) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "capsuledb-libsql-")));
      const client = createClient({ url: `file:${join(directory, "capsuledb.sqlite")}` });
      return { client, directory };
    }),
    ({ client }) => effect(client),
    ({ client, directory }) =>
      Effect.gen(function* () {
        client.close();
        yield* Effect.promise(() => rm(directory, { force: true, recursive: true }));
      }),
  );

const withLibsql = <A, E, R>(client: Client, effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    effect.pipe(
      Effect.provide(tokenLayer),
      Effect.provide(LibsqlClient.layer({ liveClient: client })),
    ),
  );

describe("reference token capsule over a host-supplied libSQL client", () => {
  it.effect("prepares, consumes once, and leaves the host client usable", () =>
    withHostClient((client) =>
      Effect.gen(function* () {
        yield* withLibsql(
          client,
          Effect.gen(function* () {
            const capsule = yield* referenceTokenCapsule;
            const registry = yield* makeRegistry({
              provider: libsqlProfile,
              capsules: [capsule],
            });
            const receipt = yield* prepare(registry);
            assert.strictEqual(receipt.provider, "libsql");
            assert.strictEqual((yield* status(registry))._tag, "Ready");

            const service = yield* Effect.service(OneTimeTokens);
            const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
            const consumed = yield* service.consume(issued.token);
            assert.strictEqual(consumed.token, issued.token);
            const replay = yield* service.consume(issued.token).pipe(Effect.flip);
            assert.strictEqual(replay._tag, "TokenAlreadyConsumed");
          }),
        );

        const result = yield* Effect.promise(() => client.execute("SELECT 2 AS value"));
        assert.strictEqual(
          (result.rows[0] as unknown as { readonly value: number } | undefined)?.value,
          2,
        );
      }),
    ),
  );

  it.effect("rolls back a failed migration and keeps the host client usable", () =>
    withHostClient((client) =>
      Effect.gen(function* () {
        yield* withLibsql(
          client,
          Effect.gen(function* () {
            const migration = yield* makeMigration({
              id: 1,
              name: "failing-libsql-migration",
              risk: "additive",
              providers: {
                Libsql: sqlMigrationBody([
                  'CREATE TABLE "libsql_failure_marker" (id TEXT PRIMARY KEY NOT NULL)',
                  "THIS IS NOT VALID SQL",
                ]),
              },
            });
            const capsule = yield* makeCapsule({
              id: "libsql.failure",
              migrations: [migration],
              layer: Layer.empty,
            });
            const registry = yield* makeRegistry({
              provider: libsqlProfile,
              capsules: [capsule],
            });
            const failure = yield* prepare(registry).pipe(Effect.flip);
            assert.strictEqual(failure._tag, "SqlError");

            const sql = yield* Effect.service(SqlClient.SqlClient);
            assert.deepStrictEqual(
              yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'libsql_failure_marker'`,
              [],
            );
            assert.deepStrictEqual(yield* sql<{ readonly value: number }>`SELECT 1 AS value`, [
              { value: 1 },
            ]);
          }),
        );

        const result = yield* Effect.promise(() => client.execute("SELECT 3 AS value"));
        assert.strictEqual(
          (result.rows[0] as unknown as { readonly value: number } | undefined)?.value,
          3,
        );
      }),
    ),
  );

  it.effect("uses a savepoint for nested transactional migration work", () =>
    withHostClient((client) =>
      withLibsql(
        client,
        Effect.gen(function* () {
          const sql = yield* Effect.service(SqlClient.SqlClient);
          yield* sql.unsafe('CREATE TABLE "libsql_savepoint_probe" (value INTEGER NOT NULL)');
          const result = yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO "libsql_savepoint_probe" (value) VALUES (1)`;
              yield* Effect.exit(
                sql.withTransaction(
                  Effect.gen(function* () {
                    yield* sql`INSERT INTO "libsql_savepoint_probe" (value) VALUES (2)`;
                    return yield* Effect.fail("rollback nested savepoint");
                  }),
                ),
              );
              return yield* sql<{ readonly value: number }>`SELECT value
                FROM "libsql_savepoint_probe" ORDER BY value`;
            }),
          );
          assert.deepStrictEqual(result, [{ value: 1 }]);
        }),
      ),
    ),
  );

  it.effect("converges concurrent preparation to one exact history", () =>
    withHostClient((client) =>
      withLibsql(
        client,
        Effect.gen(function* () {
          const migration = yield* makeMigration({
            id: 1,
            name: "concurrent-libsql-migration",
            risk: "additive",
            providers: {
              Libsql: sqlMigrationBody([
                'CREATE TABLE "libsql_concurrent_probe" (id TEXT PRIMARY KEY NOT NULL)',
              ]),
            },
          });
          const capsule = yield* makeCapsule({
            id: "libsql.concurrent",
            migrations: [migration],
            layer: Layer.empty,
          });
          const registry = yield* makeRegistry({
            provider: libsqlProfile,
            capsules: [capsule],
          });
          const receipts = yield* Effect.all([prepare(registry), prepare(registry)], {
            concurrency: "unbounded",
          });
          assert.deepStrictEqual(receipts[0], receipts[1]);
          const sql = yield* Effect.service(SqlClient.SqlClient);
          assert.deepStrictEqual(
            yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
              FROM "capsuledb_registry_ledger" WHERE capsule_id = 'libsql.concurrent'`,
            [{ count: 1 }],
          );
        }),
      ),
    ),
  );
});
