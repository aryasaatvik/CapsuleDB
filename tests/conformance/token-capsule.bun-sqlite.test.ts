import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeCapsule } from "../../src/Capsule.ts";
import { decodeManifest } from "../../src/Manifest.ts";
import { makeMigration, sqlMigrationBody } from "../../src/Migration.ts";
import { BunSqliteProfile } from "../../src/Provider.ts";
import { makeRegistry, plan, prepare, status } from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import { OneTimeTokens } from "../../examples/reference-token/OneTimeTokens.ts";
import referenceManifest from "../fixtures/reference-token-manifest.json" with { type: "json" };

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(OneTimeTokens.layer),
    Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
    Effect.scoped,
  );

describe("reference token capsule over host-supplied Bun SQLite", () => {
  it.effect("prepares privately, consumes once with audit, and reuses readiness", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsule = yield* referenceTokenCapsule;
        const registry = yield* makeRegistry({
          provider: BunSqliteProfile,
          capsules: [capsule],
        });
        const sql = yield* Effect.service(SqlClient.SqlClient);

        const registryPlan = yield* plan(registry);
        const publishedManifest = yield* decodeManifest(referenceManifest);
        assert.deepStrictEqual(registryPlan.manifest, publishedManifest);

        const pending = yield* status(registry);
        assert.strictEqual(pending._tag, "Pending");

        const firstReceipt = yield* prepare(registry);
        assert.strictEqual(firstReceipt.provider, "sqlite");
        assert.strictEqual(firstReceipt.capsuleCount, 1);

        const tables = yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
          WHERE type = 'table' ORDER BY name`;
        assert.deepStrictEqual(
          tables.map((table) => table.name).filter((name) => name !== "sqlite_sequence"),
          [
            "capsule_reference_2e_token_audit",
            "capsule_reference_2e_tokens",
            "capsuledb_registry_ledger",
            "capsuledb_registry_metadata",
          ],
        );

        const service = yield* Effect.service(OneTimeTokens);
        const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
        const consumed = yield* service.consume(issued.token);
        assert.strictEqual(consumed.token, issued.token);
        assert.strictEqual((yield* service.get(issued.token))._tag, "Consumed");

        const replay = yield* service.consume(issued.token).pipe(Effect.flip);
        assert.strictEqual(replay._tag, "TokenAlreadyConsumed");
        const auditRows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
          FROM "capsule_reference_2e_token_audit"`;
        assert.deepStrictEqual(auditRows, [{ count: 1 }]);

        const ready = yield* status(registry);
        assert.strictEqual(ready._tag, "Ready");
        const secondReceipt = yield* prepare(registry);
        assert.deepStrictEqual(secondReceipt, firstReceipt);
      }),
    ),
  );

  it.effect("rolls back a failed migration marker and keeps the host client usable", () =>
    withSqlite(
      Effect.gen(function* () {
        const migration = yield* makeMigration({
          id: 1,
          name: "failing-marker",
          risk: "additive",
          providers: {
            Sqlite: sqlMigrationBody("failing-marker-source", [
              'CREATE TABLE "capsule_failure_marker" (id TEXT PRIMARY KEY NOT NULL)',
              "THIS IS NOT VALID SQL",
            ]),
          },
        });
        const capsule = yield* makeCapsule({
          id: "failure.probe",
          migrations: [migration],
          layer: Layer.empty,
        });
        const registry = yield* makeRegistry({
          provider: BunSqliteProfile,
          capsules: [capsule],
        });
        const sql = yield* Effect.service(SqlClient.SqlClient);

        const failure = yield* prepare(registry).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "SqlError");

        const ledgerRows = yield* sql<{ readonly migration_id: number }>`SELECT migration_id
          FROM "capsuledb_registry_ledger" WHERE capsule_id = 'failure.probe'`;
        const markerRows = yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'capsule_failure_marker'`;
        assert.deepStrictEqual(ledgerRows, []);
        assert.deepStrictEqual(markerRows, []);
        assert.deepStrictEqual(yield* sql<{ readonly value: number }>`SELECT 1 AS value`, [
          { value: 1 },
        ]);
      }),
    ),
  );

  it.effect("rolls back consumption when the audit write fails", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsule = yield* referenceTokenCapsule;
        const registry = yield* makeRegistry({
          provider: BunSqliteProfile,
          capsules: [capsule],
        });
        yield* prepare(registry);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        const service = yield* Effect.service(OneTimeTokens);
        const issued = yield* service.issue("2099-01-01T00:00:00.000Z");

        yield* sql.unsafe(`CREATE TRIGGER fail_token_audit
          BEFORE INSERT ON "capsule_reference_2e_token_audit"
          BEGIN SELECT RAISE(ABORT, 'audit failure'); END`);
        const failure = yield* service.consume(issued.token).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "SqlError");
        assert.strictEqual((yield* service.get(issued.token))._tag, "Pending");
        const auditRows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
          FROM "capsule_reference_2e_token_audit"`;
        assert.deepStrictEqual(auditRows, [{ count: 0 }]);
      }),
    ),
  );

  it.effect("does not close the host client when the capsule service scope ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* Effect.service(SqlClient.SqlClient);
        const capsule = yield* referenceTokenCapsule;
        const registry = yield* makeRegistry({
          provider: BunSqliteProfile,
          capsules: [capsule],
        });
        yield* prepare(registry);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* Effect.service(OneTimeTokens);
            const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
            yield* service.revoke(issued.token);
          }).pipe(Effect.provide(OneTimeTokens.layer)),
        );
        assert.deepStrictEqual(yield* sql<{ readonly value: number }>`SELECT 2 AS value`, [
          { value: 2 },
        ]);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
  );
});
