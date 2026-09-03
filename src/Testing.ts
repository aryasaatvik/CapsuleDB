import { Effect } from "effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { Capsule } from "./Capsule.ts";
import type { Dialect } from "./Dialect.ts";
import { InvalidDefinition } from "./Error.ts";
import type { ProviderProfile } from "./Provider.ts";
import { BunSqliteProfile } from "./Provider.ts";
import * as Registry from "./Registry.ts";
import type { Table } from "./Schema.ts";

/**
 * The conformance kit hands a capsule nothing but the host's SQL client, so a
 * capsule under test must not require any other service.
 */
type TestableCapsule = Capsule<never, unknown, SqlClient.SqlClient>;

/** One provider-neutral behavior every capsule is expected to satisfy. */
export interface Case {
  readonly name: string;
  readonly run: Effect.Effect<void, unknown, SqlClient.SqlClient>;
}

/** A conformance assertion a capsule failed. */
export class ConformanceFailure extends Error {
  override readonly name = "ConformanceFailure";
  constructor(
    readonly case_: string,
    reason: string,
  ) {
    super(`${case_}: ${reason}`);
  }
}

const expect = (condition: boolean, name: string, reason: string): Effect.Effect<void, never> =>
  condition ? Effect.void : Effect.die(new ConformanceFailure(name, reason));

const tableExists = (
  sql: SqlClient.SqlClient,
  dialect: Dialect,
  table: Table,
): Effect.Effect<boolean, SqlError> =>
  (dialect === "postgres"
    ? sql`SELECT COUNT(*)::int AS count FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = ${table.name}`
    : sql`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = ${table.name}`
  ).pipe(
    Effect.map((rows) => Number((rows[0] as { readonly count?: unknown } | undefined)?.count) > 0),
  );

/**
 * The provider-neutral lifecycle a capsule must satisfy on one host database.
 *
 * Each case is an ordinary Effect, so any runner can drive them. The cases
 * migrate and read the database they are given: point them at a scratch
 * database, not a database you care about.
 */
export const conformance = (
  capsule: TestableCapsule,
  profile: ProviderProfile = BunSqliteProfile,
): ReadonlyArray<Case> => {
  const options = { provider: profile, capsules: [capsule] };
  const expectedPending = capsule.migrations.length;

  const cases: Array<Case> = [
    {
      name: "reports every migration as pending before preparation",
      run: Effect.gen(function* () {
        const readiness = yield* Registry.status(options);
        yield* expect(
          readiness._tag === "Pending",
          "pending before preparation",
          `expected Pending, got ${readiness._tag}`,
        );
        if (readiness._tag !== "Pending") return;
        yield* expect(
          readiness.pending.length === expectedPending,
          "pending before preparation",
          `expected ${expectedPending} pending migration(s), got ${readiness.pending.length}`,
        );
      }),
    },
    {
      name: "prepares to Ready with the manifest fingerprint",
      run: Effect.gen(function* () {
        const manifest = yield* Registry.manifest(options);
        const readiness = yield* Registry.prepare(options);
        yield* expect(
          readiness.fingerprint === manifest.fingerprint,
          "prepare fingerprint",
          "the readiness fingerprint does not match the manifest",
        );
        yield* expect(
          (yield* Registry.status(options))._tag === "Ready",
          "status after prepare",
          "status is not Ready after a successful preparation",
        );
      }),
    },
    {
      name: "creates every declared table",
      run: Effect.gen(function* () {
        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* Registry.prepare(options);
        for (const table of capsule.tables) {
          yield* expect(
            yield* tableExists(sql, profile.dialect, table),
            "declared tables exist",
            `table ${table.name} does not exist after preparation`,
          );
        }
      }),
    },
    {
      name: "prepares idempotently and asserts readiness",
      run: Effect.gen(function* () {
        const first = yield* Registry.prepare(options);
        const second = yield* Registry.prepare(options);
        yield* expect(
          first.fingerprint === second.fingerprint && first.provider === second.provider,
          "idempotent prepare",
          "a second preparation produced a different readiness",
        );
        yield* Registry.assert(options);
      }),
    },
    {
      name: "provides its service and leaves the host client usable",
      run: Effect.gen(function* () {
        const sql = yield* Effect.service(SqlClient.SqlClient);
        yield* Effect.scoped(Layer.build(Registry.layer(options)));
        const rows = yield* sql<{ readonly probe: number }>`SELECT 1 AS probe`;
        yield* expect(
          Number(rows[0]?.probe) === 1,
          "host client survives",
          "the host client is unusable after the capsule layer closed",
        );
      }),
    },
    {
      name: "keeps ledger rows when the capsule leaves the registry",
      run: Effect.gen(function* () {
        yield* Registry.prepare(options);
        yield* Registry.prepare({ provider: profile, capsules: [] });
        yield* Registry.assert(options);
      }),
    },
  ];

  return Object.freeze(cases);
};

/** Run every conformance case in order against one host-owned client. */
export const runConformance = (
  capsule: TestableCapsule,
  profile: ProviderProfile = BunSqliteProfile,
): Effect.Effect<void, unknown, SqlClient.SqlClient> =>
  Effect.forEach(conformance(capsule, profile), (testCase) => testCase.run, {
    discard: true,
  });

const missingClient = (cause: unknown): InvalidDefinition =>
  new InvalidDefinition({
    subject: "capsuledb/Testing sqlite client",
    reason: `install @effect/sql-sqlite-bun (Bun) or @effect/sql-libsql (Node) to use withSqlite: ${String(cause)}`,
  });

/**
 * Run an Effect against a throwaway in-memory SQLite database.
 *
 * Uses `@effect/sql-sqlite-bun` under Bun and `@effect/sql-libsql` elsewhere.
 * Both are optional peers, imported only when this helper is called, so the
 * rest of `capsuledb/Testing` works without either installed.
 */
export const withSqlite = <A, E>(
  run: Effect.Effect<A, E, SqlClient.SqlClient>,
): Effect.Effect<A, E | InvalidDefinition, never> =>
  Effect.gen(function* () {
    const layer = yield* Effect.tryPromise({
      try: async (): Promise<Layer.Layer<SqlClient.SqlClient, unknown, never>> => {
        if (typeof (globalThis as { readonly Bun?: unknown }).Bun !== "undefined") {
          const { SqliteClient } = await import("@effect/sql-sqlite-bun");
          return SqliteClient.layer({ filename: ":memory:" });
        }
        const { LibsqlClient } = await import("@effect/sql-libsql");
        return LibsqlClient.layer({ url: ":memory:" });
      },
      catch: missingClient,
    });
    return yield* Effect.scoped(run.pipe(Effect.provide(layer), Effect.orDie));
  }) as Effect.Effect<A, E | InvalidDefinition, never>;
