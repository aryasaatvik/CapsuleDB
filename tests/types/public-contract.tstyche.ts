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

test("capsule layers preserve typed Effect requirements", () => {
  const definition = CapsuleDB.makeCapsule({
    id: "reference.tokens",
    migrations: [],
    layer: tokenLayer,
  });

  expect(definition).type.toBeAssignableTo<
    Effect.Effect<
      CapsuleDB.Capsule<TokenService, never, SqlClient.SqlClient>,
      CapsuleDB.CapsuleDefinitionError
    >
  >();
  expect<CapsuleDB.Capsule<TokenService, never, SqlClient.SqlClient>>().type.toHaveProperty(
    "layer",
  );
  expect<CapsuleDB.Capsule<TokenService, never, SqlClient.SqlClient>>().type.toHaveProperty(
    "namespace",
  );
});

test("the public capsule remains opaque", () => {
  expect<CapsuleDB.Capsule<never>>().type.not.toHaveProperty("table");
  expect<CapsuleDB.Capsule<never>>().type.not.toHaveProperty("row");
  expect<CapsuleDB.Capsule<never>>().type.not.toHaveProperty("query");
  expect<CapsuleDB.Capsule<never>>().type.not.toHaveProperty("client");
  expect(CapsuleDB).type.not.toHaveProperty("SqliteClient");
  expect(CapsuleDB).type.not.toHaveProperty("createConnection");
});

test("public provider subpaths preserve their root exports", () => {
  expect(CapsuleDB).type.toHaveProperty("D1");
  expect(CapsuleDB).type.toHaveProperty("Pg");
  expect(CapsuleDB).type.toHaveProperty("Libsql");
  expect(d1Profile).type.toBeAssignableTo<typeof CapsuleDB.D1.profile>();
  expect(postgresProfile).type.toBeAssignableTo<typeof CapsuleDB.Pg.profile>();
  expect(libsqlProfile).type.toBeAssignableTo<typeof CapsuleDB.Libsql.profile>();
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
