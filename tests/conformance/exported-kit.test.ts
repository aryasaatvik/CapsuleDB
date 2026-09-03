import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Capsule from "../../src/Capsule.ts";
import * as Migration from "../../src/Migration.ts";
import * as Schema from "../../src/Schema.ts";
import * as Testing from "../../src/Testing.ts";

/**
 * A third-party capsule, written only against the public surface, checked with
 * the exported conformance kit and its SQLite helper. This is what a capsule
 * author outside this repository writes.
 */
const notes = Schema.table("acme_notes", {
  columns: {
    id: Schema.text(),
    body: Schema.text(),
    archived: Schema.boolean({ default: false }),
  },
  primaryKey: ["id"],
  indexes: [{ columns: ["archived"] }],
});

const thirdPartyCapsule = Capsule.make({
  id: "acme.notes",
  tables: [notes],
  migrations: [
    Migration.make({
      id: 1,
      name: "create-notes",
      risk: "additive",
      steps: [Migration.createTable(notes)],
    }),
  ],
  layer: Layer.empty,
});

describe("exported conformance kit", () => {
  it("names every case it will run", () => {
    assert.deepStrictEqual(
      Testing.conformance(thirdPartyCapsule).map((testCase) => testCase.name),
      [
        "reports every migration as pending before preparation",
        "prepares to Ready with the manifest fingerprint",
        "creates every declared table",
        "prepares idempotently and asserts readiness",
        "provides its service and leaves the host client usable",
        "keeps ledger rows when the capsule leaves the registry",
      ],
    );
  });

  it("passes for a capsule written only against the public surface", async () => {
    await Effect.runPromise(Testing.withSqlite(Testing.runConformance(thirdPartyCapsule)));
  });

  it("fails when a declared table is never created", async () => {
    const undeclared = Capsule.make({
      id: "acme.undeclared",
      tables: [notes],
      migrations: [
        Migration.make({
          id: 1,
          name: "create-something-else",
          risk: "additive",
          steps: [Migration.sql({ sqlite: ["SELECT 1"], postgres: ["SELECT 1"] })],
        }),
      ],
      layer: Layer.empty,
    });

    const exit = await Effect.runPromiseExit(
      Testing.withSqlite(Testing.runConformance(undeclared)),
    );
    assert.strictEqual(exit._tag, "Failure");
  });

  it("provides a scratch client that the caller never has to close", async () => {
    const value = await Effect.runPromise(
      Testing.withSqlite(
        Effect.gen(function* () {
          const sql = yield* Effect.service(SqlClient.SqlClient);
          const rows = yield* sql<{ readonly probe: number }>`SELECT 1 AS probe`;
          return Number(rows[0]?.probe);
        }),
      ),
    );
    assert.strictEqual(value, 1);
  });
});
