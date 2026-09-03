import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Capsule from "../../src/Capsule.ts";
import * as Migration from "../../src/Migration.ts";
import { BunSqliteProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import * as Schema from "../../src/Schema.ts";

const table = (name: string) =>
  Schema.table(name, { columns: { id: Schema.text() }, primaryKey: ["id"] });

const capsuleFor = (id: string, tableName: string) =>
  Capsule.make({
    id,
    migrations: [
      Migration.make({
        id: 1,
        name: "create-table",
        risk: "additive",
        steps: [Migration.createTable(table(tableName))],
      }),
    ],
    layer: Layer.empty,
  });

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);

describe("registry table prefix", () => {
  it.effect("keeps two prefixed registries independent in one database", () =>
    withSqlite(
      Effect.gen(function* () {
        const first = { provider: BunSqliteProfile, capsules: [capsuleFor("a.one", "prefix_a")] };
        const second = {
          provider: BunSqliteProfile,
          capsules: [capsuleFor("b.one", "prefix_b")],
          prefix: "tenant",
        };

        yield* Registry.prepare(first);
        yield* Registry.prepare(second);
        assert.strictEqual((yield* Registry.status(first))._tag, "Ready");
        assert.strictEqual((yield* Registry.status(second))._tag, "Ready");

        const sql = yield* Effect.service(SqlClient.SqlClient);
        assert.deepStrictEqual(
          yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
            WHERE type = 'table' AND name LIKE '%_registry_ledger' ORDER BY name`,
          [{ name: "capsuledb_registry_ledger" }, { name: "tenant_registry_ledger" }],
        );
        assert.deepStrictEqual(
          yield* sql<{ readonly capsule_id: string }>`SELECT capsule_id
            FROM "tenant_registry_ledger"`,
          [{ capsule_id: "b.one" }],
        );
      }),
    ),
  );

  it.effect("rejects a prefix that is not a plain identifier", () =>
    withSqlite(
      Effect.gen(function* () {
        const failure = yield* Registry.status({
          provider: BunSqliteProfile,
          capsules: [],
          prefix: 'evil"; DROP TABLE x; --',
        }).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "InvalidDefinition");
      }),
    ),
  );
});
