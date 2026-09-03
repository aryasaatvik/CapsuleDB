import { Context, Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect, test } from "tstyche";

import { profile as d1Profile } from "../../src/D1.ts";
import { profile as libsqlProfile } from "../../src/Libsql.ts";
import { profile as postgresProfile } from "../../src/Pg.ts";
import * as CapsuleDB from "../../src/index.ts";

class TokenService extends Context.Service<
  TokenService,
  { readonly issue: Effect.Effect<string> }
>()("tests/TokenService") {}

class AuditService extends Context.Service<
  AuditService,
  { readonly record: Effect.Effect<void> }
>()("tests/AuditService") {}

class ExtraMigrationService extends Context.Service<
  ExtraMigrationService,
  { readonly value: string }
>()("tests/ExtraMigrationService") {}

const tokenLayer = Layer.effect(
  TokenService,
  Effect.map(Effect.service(SqlClient.SqlClient), () => ({
    issue: Effect.succeed("opaque-token"),
  })),
);

const auditLayer = Layer.effect(
  AuditService,
  Effect.map(Effect.service(SqlClient.SqlClient), () => ({ record: Effect.void })),
);

test("a capsule is a value, not an Effect, and keeps its typed layer", () => {
  const capsule = CapsuleDB.Capsule.make({
    id: "reference.tokens",
    migrations: [],
    layer: tokenLayer,
  });

  expect(capsule).type.toBe<CapsuleDB.Capsule.Capsule<TokenService, never, SqlClient.SqlClient>>();
  expect(capsule).type.toHaveProperty("layer");
  expect(capsule).type.toHaveProperty("namespace");
});

test("a declared table infers its own row type", () => {
  const tokens = CapsuleDB.Schema.table("acme_tokens", {
    columns: {
      id: CapsuleDB.Schema.text(),
      attempts: CapsuleDB.Schema.integer(),
      consumed_at: CapsuleDB.Schema.timestamp({ nullable: true }),
    },
    primaryKey: ["id"],
  });

  expect<CapsuleDB.Schema.Row<typeof tokens>>().type.toBe<{
    readonly id: string;
    readonly attempts: number;
    readonly consumed_at: Date | null;
  }>();
  // A column that is not declared cannot be a primary key or an index column.
  expect(CapsuleDB.Schema.table).type.not.toBeCallableWith("acme_tokens", {
    columns: { id: CapsuleDB.Schema.text() },
    primaryKey: ["missing"],
  });
});

test("a migration is a value, not an Effect", () => {
  const migration = CapsuleDB.Migration.make({
    id: 1,
    name: "create-tokens",
    risk: "additive",
    steps: [CapsuleDB.Migration.sql({ sqlite: ["SELECT 1"], postgres: ["SELECT 1"] })],
  });
  expect(migration).type.toBeAssignableTo<CapsuleDB.Migration.Migration>();
});

test("one registry Layer carries every capsule's service", () => {
  const tokens = CapsuleDB.Capsule.make({ id: "a.tokens", migrations: [], layer: tokenLayer });
  const audit = CapsuleDB.Capsule.make({ id: "a.audit", migrations: [], layer: auditLayer });

  const layer = CapsuleDB.Registry.layer({
    provider: CapsuleDB.Pg.profile,
    capsules: [tokens, audit],
  });

  // Assert mode has the same output type; only the work behind it changes.
  expect(
    CapsuleDB.Registry.layer({
      provider: CapsuleDB.Pg.profile,
      capsules: [tokens, audit],
      mode: "assert",
    }),
  ).type.toBe<typeof layer>();

  expect(layer).type.toBeAssignableTo<
    Layer.Layer<TokenService | AuditService, unknown, SqlClient.SqlClient>
  >();
});

test("the public capsule remains opaque", () => {
  expect<CapsuleDB.Capsule.Capsule<never>>().type.not.toHaveProperty("row");
  expect<CapsuleDB.Capsule.Capsule<never>>().type.not.toHaveProperty("query");
  expect<CapsuleDB.Capsule.Capsule<never>>().type.not.toHaveProperty("client");
  expect(CapsuleDB).type.not.toHaveProperty("SqliteClient");
  expect(CapsuleDB).type.not.toHaveProperty("createConnection");
});

test("the root exports one namespace per module and no duplicates", () => {
  expect(CapsuleDB).type.toHaveProperty("D1");
  expect(CapsuleDB).type.toHaveProperty("Pg");
  expect(CapsuleDB).type.toHaveProperty("Libsql");
  expect(CapsuleDB).type.not.toHaveProperty("CapsuleModule");
  expect(CapsuleDB).type.not.toHaveProperty("RegistryModule");
  expect(CapsuleDB).type.not.toHaveProperty("makeCapsule");
  expect(CapsuleDB).type.not.toHaveProperty("makeRegistry");
  expect(CapsuleDB).type.toHaveProperty("Schema");
  expect(CapsuleDB).type.toHaveProperty("Dialect");
  expect<CapsuleDB.Dialect.Dialect>().type.toBe<"postgres" | "sqlite">();
  expect(CapsuleDB).type.toHaveProperty("Emit");
  expect(CapsuleDB).type.toHaveProperty("Testing");
  expect(d1Profile).type.toBeAssignableTo<typeof CapsuleDB.D1.profile>();
  expect(postgresProfile).type.toBeAssignableTo<typeof CapsuleDB.Pg.profile>();
  expect(libsqlProfile).type.toBeAssignableTo<typeof CapsuleDB.Libsql.profile>();
});

test("only one readiness model is public", () => {
  expect(CapsuleDB.Readiness).type.not.toHaveProperty("ReadinessReceipt");
  expect(CapsuleDB.Readiness).type.not.toHaveProperty("makeReadinessReceipt");
  expect(CapsuleDB.Registry).type.not.toHaveProperty("RegistryPlanState");
  expect<CapsuleDB.Readiness.Readiness["_tag"]>().type.toBe<"Ready" | "Pending" | "Drift">();
});

test("Effect migration bodies accept only the host SQL client", () => {
  const requiresExtraService = Effect.gen(function* () {
    yield* Effect.service(SqlClient.SqlClient);
    yield* Effect.service(ExtraMigrationService);
  }).pipe(Effect.asVoid);

  expect(requiresExtraService).type.not.toBeAssignableTo<
    Effect.Effect<void, never, SqlClient.SqlClient>
  >();
});
