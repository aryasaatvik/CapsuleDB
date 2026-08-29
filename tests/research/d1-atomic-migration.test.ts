import type { D1Database } from "@cloudflare/workers-types";
import { D1Client } from "@effect/sql-d1";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { isSqlError } from "effect/unstable/sql/SqlError";
import { Miniflare } from "miniflare";

import limits from "./d1-limits.json" with { type: "json" };

const LEDGER_TABLE = "capsuledb_probe_ledger";
const MARKER_TABLE = "capsuledb_probe_marker";
const CAPSULE_ID = "probe.capsule";
const MIGRATION_ID = "0001";
const WINNING_CHECKSUM = "sha256:winning";
const DIVERGENT_CHECKSUM = "sha256:divergent";

class TestD1Runtime extends Context.Service<TestD1Runtime, Miniflare>()(
  "tests/research/TestD1Runtime",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Miniflare({
            d1Databases: { DB: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
            modules: true,
            script: "",
          }),
      ),
      (miniflare) => Effect.promise(() => miniflare.dispose()),
    ),
  );

  static readonly clientLayer = Layer.unwrap(
    Effect.gen(function* () {
      const miniflare = yield* TestD1Runtime;
      const db: D1Database = yield* Effect.tryPromise({
        try: () => miniflare.getD1Database("DB"),
        catch: (cause) => new Error(`Unable to create the Miniflare D1 binding: ${String(cause)}`),
      });
      return D1Client.layer({ db });
    }),
  ).pipe(Layer.provide(TestD1Runtime.layer));
}

const ProbeRow = Schema.Struct({
  capsuleId: Schema.String,
  migrationId: Schema.String,
  checksum: Schema.String,
});

type ProbeRow = typeof ProbeRow.Type;

const createLedger = Effect.gen(function* () {
  const sql = yield* D1Client.D1Client;
  yield* sql.unsafe(
    `CREATE TABLE "${LEDGER_TABLE}" (
      capsule_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      checksum TEXT NOT NULL,
      PRIMARY KEY (capsule_id, migration_id)
    )`,
  );
  return sql;
});

const claimAndCreateMarker = (sql: D1Client.D1Client, checksum: string) =>
  sql.batch([
    sql`INSERT INTO ${sql(LEDGER_TABLE)} (capsule_id, migration_id, checksum)
      VALUES (${CAPSULE_ID}, ${MIGRATION_ID}, ${checksum})`,
    sql.unsafe(
      `CREATE TABLE "${MARKER_TABLE}" (
        id TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
    ),
  ]);

describe("D1 claim-first atomic migration probe", () => {
  it.effect("rolls back the ledger claim and DDL together", () =>
    Effect.gen(function* () {
      const sql = yield* createLedger;
      const result = yield* sql
        .batch([
          sql`INSERT INTO ${sql(LEDGER_TABLE)} (capsule_id, migration_id, checksum)
            VALUES (${CAPSULE_ID}, ${MIGRATION_ID}, ${WINNING_CHECKSUM})`,
          sql.unsafe(`CREATE TABLE "${MARKER_TABLE}" (id TEXT PRIMARY KEY NOT NULL)`),
          sql.unsafe(`CREATE TABLE "${MARKER_TABLE}" (duplicate TEXT)`),
        ])
        .pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "Failure" as const, error }),
            onSuccess: () => ({ _tag: "Success" as const }),
          }),
        );

      if (result._tag !== "Failure")
        throw new Error("The invalid DDL batch unexpectedly succeeded");
      assert.strictEqual(isSqlError(result.error), true);
      assert.strictEqual(result.error.reason._tag, "UnknownError");

      const ledgerRows =
        yield* sql<ProbeRow>`SELECT capsule_id AS "capsuleId", migration_id AS "migrationId", checksum
        FROM ${sql(LEDGER_TABLE)}`;
      const markerRows = yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = ${MARKER_TABLE}`;
      assert.deepStrictEqual(ledgerRows, []);
      assert.deepStrictEqual(markerRows, []);
    }).pipe(Effect.provide(TestD1Runtime.clientLayer)),
  );

  it.effect("converges concurrent exact claims to one applied checksum", () =>
    Effect.gen(function* () {
      const sql = yield* createLedger;
      const startedAt = performance.now();
      const outcomes = yield* Effect.all(
        [WINNING_CHECKSUM, WINNING_CHECKSUM].map((checksum) =>
          claimAndCreateMarker(sql, checksum).pipe(
            Effect.match({
              onFailure: (error) => ({ _tag: "Failure" as const, error }),
              onSuccess: () => ({ _tag: "Success" as const }),
            }),
          ),
        ),
        { concurrency: "unbounded" },
      );
      const durationMs = performance.now() - startedAt;
      const successful = outcomes.filter((outcome) => outcome._tag === "Success");
      const failed = outcomes.filter((outcome) => outcome._tag === "Failure");
      assert.strictEqual(successful.length, 1);
      assert.strictEqual(failed.length, 1);
      const loser = failed[0];
      if (loser === undefined || loser._tag !== "Failure") {
        throw new Error("The concurrent probe did not produce one classified loser");
      }
      assert.strictEqual(isSqlError(loser.error), true);
      assert.strictEqual(loser.error.reason._tag, "UnknownError");

      const ledgerRows =
        yield* sql<ProbeRow>`SELECT capsule_id AS "capsuleId", migration_id AS "migrationId", checksum
        FROM ${sql(LEDGER_TABLE)}`;
      assert.deepStrictEqual(ledgerRows, [
        { capsuleId: CAPSULE_ID, migrationId: MIGRATION_ID, checksum: WINNING_CHECKSUM },
      ]);

      const statements = [
        sql`INSERT INTO ${sql(LEDGER_TABLE)} (capsule_id, migration_id, checksum)
            VALUES (${CAPSULE_ID}, ${MIGRATION_ID}, ${WINNING_CHECKSUM})`,
        sql.unsafe(`CREATE TABLE "${MARKER_TABLE}" (id TEXT PRIMARY KEY NOT NULL)`),
      ];
      const compiled = statements.map((statement) => {
        const [source, parameters] = statement.compile();
        return {
          parameterCount: parameters.length,
          sqlBytes: new TextEncoder().encode(source).byteLength,
        };
      });
      assert.strictEqual(compiled.length, 2);
      assert.strictEqual(
        compiled.every(
          ({ parameterCount }) => parameterCount <= limits.constraints.maxBoundParameters,
        ),
        true,
      );
      assert.strictEqual(
        compiled.every(({ sqlBytes }) => sqlBytes <= limits.constraints.maxSqlStatementBytes),
        true,
      );
      assert.strictEqual(durationMs <= limits.constraints.maxQueryDurationMs, true);
    }).pipe(Effect.provide(TestD1Runtime.clientLayer)),
  );

  it.effect("accepts an exact loser after reread and rejects divergent checksums", () =>
    Effect.gen(function* () {
      const sql = yield* createLedger;
      yield* claimAndCreateMarker(sql, WINNING_CHECKSUM);

      const exactLoser = yield* claimAndCreateMarker(sql, WINNING_CHECKSUM).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Failure" as const, error }),
          onSuccess: () => ({ _tag: "Success" as const }),
        }),
      );
      if (exactLoser._tag !== "Failure")
        throw new Error("The exact duplicate unexpectedly succeeded");
      assert.strictEqual(isSqlError(exactLoser.error), true);

      const [row] =
        yield* sql<ProbeRow>`SELECT capsule_id AS "capsuleId", migration_id AS "migrationId", checksum
        FROM ${sql(LEDGER_TABLE)} WHERE capsule_id = ${CAPSULE_ID} AND migration_id = ${MIGRATION_ID}`;
      if (row === undefined) throw new Error("Concurrent loser reread returned no ledger row");
      assert.strictEqual(row.checksum, WINNING_CHECKSUM);

      const divergent = yield* claimAndCreateMarker(sql, DIVERGENT_CHECKSUM).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Failure" as const, error }),
          onSuccess: () => ({ _tag: "Success" as const }),
        }),
      );
      if (divergent._tag !== "Failure")
        throw new Error("A divergent checksum unexpectedly succeeded");
      assert.strictEqual(isSqlError(divergent.error), true);

      const [divergentReread] =
        yield* sql<ProbeRow>`SELECT capsule_id AS "capsuleId", migration_id AS "migrationId", checksum
        FROM ${sql(LEDGER_TABLE)} WHERE capsule_id = ${CAPSULE_ID} AND migration_id = ${MIGRATION_ID}`;
      if (divergentReread === undefined)
        throw new Error("Divergent checksum reread returned no ledger row");
      assert.notStrictEqual(divergentReread.checksum, DIVERGENT_CHECKSUM);
      assert.strictEqual(divergentReread.checksum, WINNING_CHECKSUM);
    }).pipe(Effect.provide(TestD1Runtime.clientLayer)),
  );

  it.effect("records the static bounded batch profile", () =>
    Effect.gen(function* () {
      const sql = yield* D1Client.D1Client;
      const statements = [
        sql`INSERT INTO ${sql(LEDGER_TABLE)} (capsule_id, migration_id, checksum)
            VALUES (${CAPSULE_ID}, ${MIGRATION_ID}, ${WINNING_CHECKSUM})`,
        sql.unsafe(`CREATE TABLE "${MARKER_TABLE}" (id TEXT PRIMARY KEY NOT NULL)`),
      ];
      const statementCount = statements.length;
      const compiled = statements.map((statement) => {
        const [source, parameters] = statement.compile();
        return {
          parameterCount: parameters.length,
          sqlBytes: new TextEncoder().encode(source).byteLength,
        };
      });
      assert.strictEqual(limits.batchPolicy.claimMustBeFirst, true);
      assert.strictEqual(statementCount <= 2, true);
      assert.strictEqual(
        compiled.every(
          ({ parameterCount }) => parameterCount <= limits.constraints.maxBoundParameters,
        ),
        true,
      );
      assert.strictEqual(
        compiled.every(({ sqlBytes }) => sqlBytes <= limits.constraints.maxSqlStatementBytes),
        true,
      );
      yield* Effect.void;
    }).pipe(Effect.provide(TestD1Runtime.clientLayer)),
  );
});
