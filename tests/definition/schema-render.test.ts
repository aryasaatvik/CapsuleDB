import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Capsule from "../../src/Capsule.ts";
import * as Dialect from "../../src/Dialect.ts";
import * as Migration from "../../src/Migration.ts";
import { BunSqliteProfile, PostgresProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import * as Schema from "../../src/Schema.ts";
import { withPostgresSql } from "../providers/postgres.ts";

const sessions = Schema.table("schema_render_sessions", {
  columns: {
    id: Schema.text(),
    owner_id: Schema.text(),
    attempts: Schema.integer({ default: 0 }),
    total_bytes: Schema.bigint({ default: 0 }),
    revoked: Schema.boolean({ default: false }),
    payload: Schema.json({ nullable: true }),
    consumed_at: Schema.timestamp({ nullable: true }),
    created_at: Schema.timestamp({ default: { sql: "CURRENT_TIMESTAMP" } }),
    label: Schema.text({ default: "it's default" }),
  },
  primaryKey: ["id"],
  uniques: [["owner_id", "label"]],
  indexes: [
    { columns: ["owner_id"] },
    { name: "schema_render_live", columns: ["consumed_at"], unique: true, where: "attempts = 0" },
  ],
  checks: [{ name: "schema_render_attempts_positive", sql: "attempts >= 0" }],
});

describe("declarative schema rendering", () => {
  it("renders deterministic PostgreSQL DDL", () => {
    const statements = Dialect.render(Migration.createTable(sessions), "postgres");
    assert.deepStrictEqual(statements, [
      `CREATE TABLE "schema_render_sessions" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "total_bytes" BIGINT NOT NULL DEFAULT 0,
  "revoked" BOOLEAN NOT NULL DEFAULT FALSE,
  "payload" JSONB,
  "consumed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "label" TEXT NOT NULL DEFAULT 'it''s default',
  PRIMARY KEY ("id"),
  UNIQUE ("owner_id", "label"),
  CONSTRAINT "schema_render_attempts_positive" CHECK (attempts >= 0)
)`,
      `CREATE INDEX "schema_render_sessions_owner_id_idx" ON "schema_render_sessions" ("owner_id")`,
      `CREATE UNIQUE INDEX "schema_render_live" ON "schema_render_sessions" ("consumed_at") WHERE attempts = 0`,
    ]);
    assert.deepStrictEqual(Dialect.render(Migration.createTable(sessions), "postgres"), statements);
  });

  it("renders deterministic SQLite DDL", () => {
    assert.deepStrictEqual(Dialect.render(Migration.createTable(sessions), "sqlite"), [
      `CREATE TABLE "schema_render_sessions" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "total_bytes" INTEGER NOT NULL DEFAULT 0,
  "revoked" INTEGER NOT NULL DEFAULT 0,
  "payload" TEXT,
  "consumed_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "label" TEXT NOT NULL DEFAULT 'it''s default',
  PRIMARY KEY ("id"),
  UNIQUE ("owner_id", "label"),
  CONSTRAINT "schema_render_attempts_positive" CHECK (attempts >= 0)
)`,
      `CREATE INDEX "schema_render_sessions_owner_id_idx" ON "schema_render_sessions" ("owner_id")`,
      `CREATE UNIQUE INDEX "schema_render_live" ON "schema_render_sessions" ("consumed_at") WHERE attempts = 0`,
    ]);
  });

  it("renders the incremental steps per dialect", () => {
    const note = Schema.text({ nullable: true });
    assert.deepStrictEqual(Dialect.render(Migration.addColumn("t", "note", note), "postgres"), [
      `ALTER TABLE "t" ADD COLUMN "note" TEXT`,
    ]);
    assert.deepStrictEqual(
      Dialect.render(Migration.createIndex("t", { columns: ["note"] }), "sqlite"),
      [`CREATE INDEX "t_note_idx" ON "t" ("note")`],
    );
    assert.deepStrictEqual(Dialect.render(Migration.dropTable("t"), "sqlite"), [`DROP TABLE "t"`]);
  });

  it("rejects a table whose indexes would render the same name twice", () => {
    assert.throws(() =>
      Schema.table("dupes", {
        columns: { a: Schema.text(), b: Schema.text() },
        primaryKey: ["a"],
        indexes: [{ columns: ["b"] }, { columns: ["b"] }],
      }),
    );
    assert.throws(() =>
      Schema.table("dupes", {
        columns: { a: Schema.text(), b: Schema.text() },
        primaryKey: ["a"],
        indexes: [{ columns: ["b"] }, { name: "dupes_b_idx", columns: ["a"] }],
      }),
    );
    assert.throws(() =>
      Schema.table("dupes", {
        columns: { a: Schema.text() },
        primaryKey: ["a"],
        checks: [
          { name: "same", sql: "a IS NOT NULL" },
          { name: "same", sql: "a <> ''" },
        ],
      }),
    );
  });

  it("validates identifiers in the incremental steps too", () => {
    const note = Schema.text({ nullable: true });
    assert.throws(() => Migration.addColumn('t" ; DROP TABLE x; --', "note", note));
    assert.throws(() => Migration.addColumn("t", 'note" ; DROP TABLE x; --', note));
    assert.throws(() => Migration.dropTable('t" ; DROP TABLE x; --'));
    assert.throws(() => Migration.createIndex("t", { columns: ['note"; --'] }));
    assert.throws(() => Migration.createIndex("t", { name: 'i"; --', columns: ["note"] }));
    assert.throws(() => Migration.createIndex("t", { columns: [] }));
  });

  it("rejects an identifier that could escape the quoting it is rendered into", () => {
    assert.throws(() =>
      Schema.table('evil" (x TEXT); DROP TABLE "victim', {
        columns: { id: Schema.text() },
        primaryKey: ["id"],
      }),
    );
    assert.throws(() =>
      Schema.table("fine", {
        columns: { id: Schema.text() },
        primaryKey: ["missing"] as unknown as ReadonlyArray<"id">,
      }),
    );
  });

  const capsule = Capsule.make({
    id: "schema.render",
    migrations: [
      Migration.make({
        id: 1,
        name: "create-sessions",
        risk: "additive",
        steps: [Migration.createTable(sessions)],
      }),
      Migration.make({
        id: 2,
        name: "add-note",
        risk: "additive",
        steps: [
          Migration.addColumn("schema_render_sessions", "note", Schema.text({ nullable: true })),
          Migration.createIndex("schema_render_sessions", { columns: ["note"] }),
        ],
      }),
    ],
    layer: Layer.empty,
  });

  const insertAndRead = Effect.gen(function* () {
    const sql = yield* Effect.service(SqlClient.SqlClient);
    yield* sql`INSERT INTO ${sql("schema_render_sessions")} (id, owner_id, payload, created_at)
      VALUES ('a', 'owner', NULL, CURRENT_TIMESTAMP)`;
    const rows = yield* sql<{
      readonly id: string;
      readonly attempts: number;
    }>`SELECT id, attempts FROM ${sql("schema_render_sessions")}`;
    assert.strictEqual(rows[0]?.id, "a");
    assert.strictEqual(Number(rows[0]?.attempts), 0);
  });

  it.effect("applies one declaration on Bun SQLite", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Registry.prepare({ provider: BunSqliteProfile, capsules: [capsule] });
        yield* insertAndRead;
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
  );

  it.effect(
    "applies the same declaration on PostgreSQL",
    () =>
      withPostgresSql((client) =>
        Effect.gen(function* () {
          yield* Registry.prepare({ provider: PostgresProfile, capsules: [capsule] });
          yield* insertAndRead;
        }).pipe(Effect.provideService(SqlClient.SqlClient, client)),
      ),
    60_000,
  );

  it("exposes the declared tables on the capsule", () => {
    assert.deepStrictEqual(
      capsule.tables.map((table) => table.name),
      ["schema_render_sessions"],
    );
  });
});
