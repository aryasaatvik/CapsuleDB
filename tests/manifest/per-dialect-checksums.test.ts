import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Capsule from "../../src/Capsule.ts";
import type { Dialect } from "../../src/Dialect.ts";
import { bodyFor, buildManifest } from "../../src/Manifest.ts";
import * as Migration from "../../src/Migration.ts";
import { BunSqliteProfile, PostgresProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import { withPostgresSql } from "../providers/postgres.ts";

const CREATE_TOKENS = 'CREATE TABLE "checksum_tokens" (id TEXT PRIMARY KEY NOT NULL)';

const capsuleWith = (bodies: Partial<Record<Dialect, ReadonlyArray<string>>>) =>
  Capsule.make({
    id: "checksum.tokens",
    migrations: [
      Migration.make({
        id: 1,
        name: "create-tokens",
        risk: "additive",
        steps: [Migration.sql(bodies)],
      }),
    ],
    layer: Layer.empty,
  });

const checksumOf = (
  capsule: ReturnType<typeof capsuleWith>,
  dialect: Dialect,
): Effect.Effect<string, unknown> =>
  buildManifest({ capsules: [capsule] }).pipe(
    Effect.map((manifest) => {
      const migration = manifest.capsules[0]?.migrations[0];
      if (migration === undefined) throw new Error("manifest is empty");
      const body = bodyFor(migration, dialect);
      if (body === undefined) throw new Error(`no ${dialect} body`);
      return body.checksum as string;
    }),
  );

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);

describe("per-dialect migration checksums", () => {
  it.effect("does not change the postgres checksum when a sqlite body is added", () =>
    Effect.gen(function* () {
      const postgresOnly = capsuleWith({ postgres: [CREATE_TOKENS] });
      const both = capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [CREATE_TOKENS] });

      assert.strictEqual(
        yield* checksumOf(postgresOnly, "postgres"),
        yield* checksumOf(both, "postgres"),
      );
    }),
  );

  it.effect("changes only the edited dialect's checksum", () =>
    Effect.gen(function* () {
      const original = capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [CREATE_TOKENS] });
      const edited = capsuleWith({
        postgres: [`${CREATE_TOKENS} /* reformatted */`],
        sqlite: [CREATE_TOKENS],
      });

      assert.notStrictEqual(
        yield* checksumOf(original, "postgres"),
        yield* checksumOf(edited, "postgres"),
      );
      assert.strictEqual(
        yield* checksumOf(original, "sqlite"),
        yield* checksumOf(edited, "sqlite"),
      );
    }),
  );

  it.effect(
    "keeps a deployed PostgreSQL host Ready after a SQLite body is added",
    () =>
      withPostgresSql((client) =>
        Effect.gen(function* () {
          const deployed = {
            provider: PostgresProfile,
            capsules: [capsuleWith({ postgres: [CREATE_TOKENS] })],
          };
          yield* Registry.prepare(deployed);

          const upgraded = {
            provider: PostgresProfile,
            capsules: [capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [CREATE_TOKENS] })],
          };
          assert.strictEqual((yield* Registry.status(upgraded))._tag, "Ready");
          yield* Registry.assert(upgraded);
        }).pipe(Effect.provideService(SqlClient.SqlClient, client)),
      ),
    60_000,
  );

  it.effect("reports drift on the edited dialect and not on the other one", () =>
    withSqlite(
      Effect.gen(function* () {
        const original = capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [CREATE_TOKENS] });
        yield* Registry.prepare({ provider: BunSqliteProfile, capsules: [original] });

        const editedPostgres = {
          provider: BunSqliteProfile,
          capsules: [
            capsuleWith({ postgres: [`${CREATE_TOKENS} /* edited */`], sqlite: [CREATE_TOKENS] }),
          ],
        };
        assert.strictEqual((yield* Registry.status(editedPostgres))._tag, "Ready");

        const editedSqlite = {
          provider: BunSqliteProfile,
          capsules: [
            capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [`${CREATE_TOKENS} /* edited */`] }),
          ],
        };
        const readiness = yield* Registry.status(editedSqlite);
        assert.strictEqual(readiness._tag, "Drift");

        const failure = yield* Registry.prepare(editedSqlite).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "LedgerConflict");
        if (failure._tag === "LedgerConflict") assert.strictEqual(failure.dialect, "sqlite");
      }),
    ),
  );

  it.effect("refuses to re-key a manifest v1 ledger row without authorization", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsule = capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [CREATE_TOKENS] });
        const options = { provider: BunSqliteProfile, capsules: [capsule] };
        yield* Registry.prepare(options);

        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* sql.unsafe(`UPDATE "capsuledb_registry_ledger"
          SET checksum = '${"a".repeat(64)}', dialect = NULL
          WHERE capsule_id = 'checksum.tokens'`);

        const failure = yield* Registry.prepare(options).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "LegacyLedgerUpgradeUnauthorized");

        const readiness = yield* Registry.status(options);
        assert.strictEqual(readiness._tag, "Drift");
        if (readiness._tag === "Drift") {
          assert.strictEqual(readiness.reason.includes("allowLegacyLedgerUpgrade"), true);
        }

        // The row is untouched, so the evidence of what was applied survives.
        const rows = yield* sql<{ readonly checksum: string }>`SELECT checksum
          FROM "capsuledb_registry_ledger" WHERE capsule_id = 'checksum.tokens'`;
        assert.strictEqual(rows[0]?.checksum, "a".repeat(64));
      }),
    ),
  );

  it.effect("upgrades a manifest v1 ledger row when the operator opts in", () =>
    withSqlite(
      Effect.gen(function* () {
        const capsule = capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [CREATE_TOKENS] });
        const options = { provider: BunSqliteProfile, capsules: [capsule] };
        yield* Registry.prepare(options);

        // A row written by CapsuleDB 0.1: no dialect, and a checksum that
        // covered every dialect body at once, so it matches nothing here.
        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* sql.unsafe(`UPDATE "capsuledb_registry_ledger"
          SET checksum = '${"a".repeat(64)}', dialect = NULL
          WHERE capsule_id = 'checksum.tokens'`);

        const upgrading = { ...options, allowLegacyLedgerUpgrade: true };
        yield* Registry.prepare(upgrading);

        const rows = yield* sql<{
          readonly checksum: string;
          readonly dialect: string | null;
        }>`SELECT checksum, dialect FROM "capsuledb_registry_ledger"
          WHERE capsule_id = 'checksum.tokens'`;
        assert.strictEqual(rows[0]?.dialect, "sqlite");
        assert.strictEqual(rows[0]?.checksum, yield* checksumOf(capsule, "sqlite"));

        // Once re-keyed the row is an ordinary v2 row: no opt-in needed again.
        assert.strictEqual((yield* Registry.status(options))._tag, "Ready");
      }),
    ),
  );

  it.effect("still fails closed when a v1 row's migration name diverges", () =>
    withSqlite(
      Effect.gen(function* () {
        const options = {
          provider: BunSqliteProfile,
          capsules: [capsuleWith({ postgres: [CREATE_TOKENS], sqlite: [CREATE_TOKENS] })],
          allowLegacyLedgerUpgrade: true,
        };
        yield* Registry.prepare(options);

        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* sql.unsafe(`UPDATE "capsuledb_registry_ledger"
          SET checksum = '${"a".repeat(64)}', dialect = NULL, name = 'renamed-migration'
          WHERE capsule_id = 'checksum.tokens'`);

        const failure = yield* Registry.prepare(options).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "LedgerConflict");
      }),
    ),
  );
});
