import { Context, Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect, test } from "tstyche";

import * as CapsuleDB from "../../src/index.ts";

class TokenService extends Context.Service<
  TokenService,
  { readonly issue: Effect.Effect<string> }
>()("tests/TokenService") {}

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
