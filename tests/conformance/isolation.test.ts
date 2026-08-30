import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { makeCapsule } from "../../src/Capsule.ts";
import { makeMigration, sqlMigrationBody } from "../../src/Migration.ts";
import { BunSqliteProfile } from "../../src/Provider.ts";
import { makeRegistry, prepare, status } from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import { providerCases } from "../providers/cases.ts";

const ISOLATION_TABLE = "capsule_isolation_probe";

interface IsolationProbeService {
  readonly put: (value: number) => Effect.Effect<void, SqlError>;
  readonly count: () => Effect.Effect<number, SqlError>;
}

class IsolationProbe extends Context.Service<IsolationProbe, IsolationProbeService>()(
  "tests/conformance/IsolationProbe",
) {
  static readonly layer: Layer.Layer<IsolationProbe, never, SqlClient.SqlClient> = Layer.effect(
    IsolationProbe,
    Effect.map(Effect.service(SqlClient.SqlClient), (sql) => ({
      put: (value: number) => sql`INSERT INTO ${sql(ISOLATION_TABLE)} (value) VALUES (${value})`,
      count: () =>
        sql<{ readonly count: number }>`SELECT COUNT(*) AS count
          FROM ${sql(ISOLATION_TABLE)}`.pipe(Effect.map((rows) => rows[0]?.count ?? 0)),
    })),
  );
}

const makeEmptyCapsule = (id: string) => makeCapsule({ id, migrations: [], layer: Layer.empty });

const isolationCapsule = Effect.gen(function* () {
  const migration = yield* makeMigration({
    id: 1,
    name: "create-isolation-probe",
    risk: "additive",
    providers: {
      Sqlite: sqlMigrationBody([`CREATE TABLE "${ISOLATION_TABLE}" (value INTEGER NOT NULL)`]),
      Libsql: sqlMigrationBody([`CREATE TABLE "${ISOLATION_TABLE}" (value INTEGER NOT NULL)`]),
      Postgres: sqlMigrationBody([`CREATE TABLE "${ISOLATION_TABLE}" (value INTEGER NOT NULL)`]),
      D1: sqlMigrationBody([`CREATE TABLE "${ISOLATION_TABLE}" (value INTEGER NOT NULL)`]),
    },
  });
  return yield* makeCapsule({
    id: "isolation.probe",
    migrations: [migration],
    layer: IsolationProbe.layer,
  });
});

const tableNames = (provider: (typeof providerCases)[number], client: SqlClient.SqlClient) =>
  provider.profile.dialect._tag === "Postgres"
    ? client<{ readonly name: string }>`SELECT tablename AS name
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('capsule_reference_2e_tokens', ${ISOLATION_TABLE})
        ORDER BY tablename`
    : client<{ readonly name: string }>`SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('capsule_reference_2e_tokens', ${ISOLATION_TABLE})
        ORDER BY name`;

describe("CapsuleDB capsule isolation", () => {
  for (const provider of providerCases) {
    it.effect(
      `${provider.name} registers and operates two isolated capsules`,
      () =>
        provider.withClient((client) =>
          Effect.gen(function* () {
            const first = yield* referenceTokenCapsule;
            const second = yield* isolationCapsule;
            const registry = yield* makeRegistry({
              provider: provider.profile,
              capsules: [first, second],
            });
            yield* prepare(registry);
            assert.strictEqual((yield* status(registry))._tag, "Ready");
            assert.deepStrictEqual(yield* tableNames(provider, client), [
              { name: "capsule_isolation_probe" },
              { name: "capsule_reference_2e_tokens" },
            ]);

            yield* Effect.scoped(
              Effect.gen(function* () {
                const service = yield* Effect.service(IsolationProbe);
                yield* service.put(7);
                assert.strictEqual(Number(yield* service.count()), 1);
              }).pipe(
                Effect.provide(IsolationProbe.layer),
                Effect.provideService(SqlClient.SqlClient, client),
              ),
            );
            const rows = yield* client<{ readonly count: number | string }>`SELECT COUNT(*) AS count
              FROM ${client(ISOLATION_TABLE)}`;
            assert.strictEqual(Number(rows[0]?.count), 1);
          }).pipe(Effect.provideService(SqlClient.SqlClient, client)),
        ),
      provider.profile.dialect._tag === "Postgres" ? 60_000 : 30_000,
    );
  }

  it.effect("rejects duplicate IDs and derived namespace collisions", () =>
    Effect.gen(function* () {
      const first = yield* makeEmptyCapsule("collision.first");
      const second = yield* makeEmptyCapsule("collision.second");

      const duplicate = yield* makeRegistry({
        provider: BunSqliteProfile,
        capsules: [first, first],
      }).pipe(Effect.flip);
      assert.strictEqual(duplicate._tag, "DuplicateCapsule");

      const collision = yield* makeRegistry({
        provider: BunSqliteProfile,
        capsules: [first, Object.freeze({ ...second, namespace: first.namespace })],
      }).pipe(Effect.flip);
      assert.strictEqual(collision._tag, "NamespaceCollision");
    }),
  );
});
