/**
 * A complete CapsuleDB program. The quick start on capsuledb.arya.sh renders
 * its regions, and `tests/artifact/quick-start.test.ts` runs it against the
 * built package. A package declares a capsule with one private table and a
 * service; the host composes it over a Bun SQLite client it owns.
 */
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Context, Data, Effect, Layer } from "effect";
import * as SqlClient from "effect/sql/SqlClient";

import { Capsule, Migration, Registry, Schema, SqliteBun } from "capsuledb";

// #region table
const visits = Schema.table("capsule_example_2e_visits", {
  columns: {
    path: Schema.text(),
    hits: Schema.integer(),
  },
  primaryKey: ["path"],
});
// #endregion

// #region service
/** The only failure the host sees; SQL errors stay inside the capsule. */
export class VisitsUnavailable extends Data.TaggedError("VisitsUnavailable")<{
  readonly cause: unknown;
}> {}

export class Visits extends Context.Service<
  Visits,
  { readonly record: (path: string) => Effect.Effect<number, VisitsUnavailable> }
>()("example/Visits") {}

const visitsLayer = Layer.effect(
  Visits,
  Effect.map(Effect.service(SqlClient.SqlClient), (sql) => ({
    record: (path: string) =>
      sql<{ readonly hits: number }>`INSERT INTO ${sql("capsule_example_2e_visits")} (path, hits)
        VALUES (${path}, 1)
        ON CONFLICT (path) DO UPDATE SET hits = hits + 1
        RETURNING hits`.pipe(
        Effect.map((rows) => rows[0]?.hits ?? 0),
        Effect.mapError((cause) => new VisitsUnavailable({ cause })),
      ),
  })),
);
// #endregion

// #region capsule
export const capsule = Capsule.make({
  id: "example.visits",
  tables: [visits],
  migrations: [
    Migration.make({
      id: 1,
      name: "create-visits",
      risk: "additive",
      steps: [Migration.createTable(visits)],
    }),
  ],
  layer: visitsLayer,
});
// #endregion

// #region compose
export const CapsulesLive = Registry.layer({
  provider: SqliteBun.profile,
  capsules: [capsule],
});
// #endregion

// #region run
const program = Effect.gen(function* () {
  const visits = yield* Effect.service(Visits);
  yield* visits.record("/docs");
  return yield* visits.record("/docs");
});

// The host owns the client: here an in-memory Bun SQLite database.
export const main = program.pipe(
  Effect.provide(CapsulesLive),
  Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
);
// #endregion
