import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Capsule from "../../src/Capsule.ts";
import { buildManifest } from "../../src/Manifest.ts";
import * as Migration from "../../src/Migration.ts";
import { BunSqliteProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import {
  OneTimeTokens,
  layer as tokenLayer,
} from "../../examples/reference-token/OneTimeTokens.ts";

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(tokenLayer),
    Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
    Effect.scoped,
  );

describe("reference token capsule over host-supplied Bun SQLite", () => {
  it.effect("prepares privately, consumes once with audit, and reuses readiness", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsule = referenceTokenCapsule;
        const registry = {
          provider: BunSqliteProfile,
          capsules: [capsule],
        };
        const sql = yield* Effect.service(SqlClient.SqlClient);

        const registryManifest = yield* Registry.manifest(registry);
        const publishedManifest = yield* buildManifest({ capsules: [capsule] });
        assert.deepStrictEqual(registryManifest, publishedManifest);

        const pending = yield* Registry.status(registry);
        assert.strictEqual(pending._tag, "Pending");

        const firstReceipt = yield* Registry.prepare(registry);
        assert.strictEqual(firstReceipt.provider, "sqlite");
        assert.strictEqual(firstReceipt.capsules, 1);

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
        const invalidExpiry = yield* service.issue("01/01/2099").pipe(Effect.flip);
        assert.strictEqual(invalidExpiry._tag, "InvalidToken");
        const invalidOffset = yield* service.issue("2099-01-01T00:00:00+14:01").pipe(Effect.flip);
        assert.strictEqual(invalidOffset._tag, "InvalidToken");
        const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
        const consumed = yield* service.consume(issued.token);
        assert.strictEqual(consumed.token, issued.token);
        assert.strictEqual((yield* service.get(issued.token))._tag, "Consumed");

        const replay = yield* service.consume(issued.token).pipe(Effect.flip);
        assert.strictEqual(replay._tag, "TokenAlreadyConsumed");
        const auditRows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
          FROM "capsule_reference_2e_token_audit"`;
        assert.deepStrictEqual(auditRows, [{ count: 1 }]);

        const ready = yield* Registry.status(registry);
        assert.strictEqual(ready._tag, "Ready");
        const secondReceipt = yield* Registry.prepare(registry);
        assert.deepStrictEqual(secondReceipt, firstReceipt);
      }),
    ),
  );

  it.effect("does not trust metadata when the migration ledger is incomplete", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsule = referenceTokenCapsule;
        const registry = {
          provider: BunSqliteProfile,
          capsules: [capsule],
        };
        yield* Registry.prepare(registry);
        const sql = yield* Effect.service(SqlClient.SqlClient);

        yield* sql.unsafe(
          `DELETE FROM "capsuledb_registry_ledger"
           WHERE capsule_id = 'reference.tokens' AND migration_id = 2`,
        );

        const current = yield* Registry.status(registry);
        assert.strictEqual(current._tag, "Drift");
        const readinessError = yield* Registry.assert(registry).pipe(Effect.flip);
        assert.strictEqual(readinessError._tag, "NotReady");
      }),
    ),
  );

  it.effect("rolls back a failed migration marker and keeps the host client usable", () =>
    withSqlite(
      Effect.gen(function* () {
        const migration = Migration.make({
          id: 1,
          name: "failing-marker",
          risk: "additive",
          providers: {
            Sqlite: Migration.sqlBody([
              'CREATE TABLE "capsule_failure_marker" (id TEXT PRIMARY KEY NOT NULL)',
              "THIS IS NOT VALID SQL",
            ]),
          },
        });
        const capsule = Capsule.make({
          id: "failure.probe",
          migrations: [migration],
          layer: Layer.empty,
        });
        const registry = {
          provider: BunSqliteProfile,
          capsules: [capsule],
        };
        const sql = yield* Effect.service(SqlClient.SqlClient);

        const failure = yield* Registry.prepare(registry).pipe(Effect.flip);
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
        const capsule = referenceTokenCapsule;
        const registry = {
          provider: BunSqliteProfile,
          capsules: [capsule],
        };
        yield* Registry.prepare(registry);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        const service = yield* Effect.service(OneTimeTokens);
        const issued = yield* service.issue("2099-01-01T00:00:00.000Z");

        yield* sql.unsafe(`CREATE TRIGGER fail_token_audit
          BEFORE INSERT ON "capsule_reference_2e_token_audit"
          BEGIN SELECT RAISE(ABORT, 'audit failure'); END`);
        const failure = yield* service.consume(issued.token).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "TokenPersistenceError");
        assert.strictEqual((yield* service.get(issued.token))._tag, "Pending");
        const auditRows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
          FROM "capsule_reference_2e_token_audit"`;
        assert.deepStrictEqual(auditRows, [{ count: 0 }]);
      }),
    ),
  );

  it.effect("checks expiry against the database clock in the atomic consumption update", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsule = referenceTokenCapsule;
        const registry = {
          provider: BunSqliteProfile,
          capsules: [capsule],
        };
        yield* Registry.prepare(registry);
        const sql = yield* Effect.service(SqlClient.SqlClient);
        const service = yield* Effect.service(OneTimeTokens);

        const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
        const tokenRows = yield* sql<{ readonly token_hash: string }>`SELECT token_hash
          FROM "capsule_reference_2e_tokens"`;
        assert.strictEqual(tokenRows.length, 1);
        const tokenRow = tokenRows[0];
        if (tokenRow === undefined) throw new Error("issued token was not persisted");
        yield* sql`UPDATE "capsule_reference_2e_tokens"
          SET expires_at = '2000-01-01T00:00:00.000Z'
          WHERE token_hash = ${tokenRow.token_hash}`;

        vi.useFakeTimers();
        vi.setSystemTime(new Date("1970-01-01T00:00:00.000Z"));
        const failure = yield* service.consume(issued.token).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "TokenNotFound");
        const auditRows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
          FROM "capsule_reference_2e_token_audit"`;
        assert.deepStrictEqual(auditRows, [{ count: 0 }]);
      }).pipe(Effect.ensuring(Effect.sync(() => vi.useRealTimers()))),
    ),
  );

  it.effect("does not close the host client when the capsule service scope ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* Effect.service(SqlClient.SqlClient);
        const capsule = referenceTokenCapsule;
        const registry = {
          provider: BunSqliteProfile,
          capsules: [capsule],
        };
        yield* Registry.prepare(registry);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* Effect.service(OneTimeTokens);
            const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
            yield* service.revoke(issued.token);
          }).pipe(Effect.provide(tokenLayer)),
        );
        assert.deepStrictEqual(yield* sql<{ readonly value: number }>`SELECT 2 AS value`, [
          { value: 2 },
        ]);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
  );
});
