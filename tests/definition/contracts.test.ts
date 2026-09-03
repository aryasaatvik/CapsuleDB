import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import * as Capsule from "../../src/Capsule.ts";
import { CapsuleDefinitionError } from "../../src/Error.ts";
import * as Migration from "../../src/Migration.ts";
import { BunSqliteProfile, D1Profile, makeProviderProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";

const noopCapsule = (id: string) => Capsule.make({ id, migrations: [], layer: Layer.empty });

describe("CapsuleDB definition contracts", () => {
  it("derives one stable namespace from a validated capsule ID", () => {
    const capsule = noopCapsule("reference.tokens");
    assert.strictEqual(capsule.namespace, Capsule.deriveNamespace(capsule.id));
    assert.notStrictEqual(capsule.namespace, "reference.tokens");
  });

  it("throws on an invalid capsule ID instead of returning an Effect", () => {
    assert.throws(() => noopCapsule("Not valid"), CapsuleDefinitionError);
  });

  it("throws on an invalid migration definition instead of returning an Effect", () => {
    assert.throws(
      () => Migration.make({ id: 0, name: "zero", risk: "additive", providers: {} }),
      CapsuleDefinitionError,
    );
    assert.throws(
      () => Migration.make({ id: 1, name: "no-bodies", risk: "additive", providers: {} }),
      CapsuleDefinitionError,
    );
  });

  it.effect("rejects duplicate IDs and physical namespace collisions", () =>
    Effect.gen(function* () {
      const first = noopCapsule("first");
      const duplicate = yield* Registry.manifest({
        provider: BunSqliteProfile,
        capsules: [first, noopCapsule("first")],
      }).pipe(Effect.flip);
      assert.strictEqual(duplicate._tag, "DuplicateCapsule");

      const second = noopCapsule("second");
      const collision = yield* Registry.manifest({
        provider: BunSqliteProfile,
        capsules: [first, Object.freeze({ ...second, namespace: first.namespace })],
      }).pipe(Effect.flip);
      assert.strictEqual(collision._tag, "NamespaceCollision");
    }),
  );

  it.effect("does not allow D1 to advertise transactional execution", () =>
    Effect.gen(function* () {
      const result = yield* makeProviderProfile({
        provider: D1Profile.provider,
        dialect: D1Profile.dialect,
        capabilities: BunSqliteProfile.capabilities,
      }).pipe(Effect.flip);
      assert.strictEqual(result._tag, "UnsupportedCapability");
    }),
  );

  it.effect("rejects provider profiles that mix identity and SQL dialect", () =>
    Effect.gen(function* () {
      const result = yield* makeProviderProfile({
        provider: D1Profile.provider,
        dialect: { _tag: "Postgres" },
        capabilities: D1Profile.capabilities,
      }).pipe(Effect.flip);
      assert.strictEqual(result._tag, "InvalidDefinition");
    }),
  );

  it.effect("requires a migration implementation for the selected provider", () =>
    Effect.gen(function* () {
      const capsule = Capsule.make({
        id: "private.state",
        migrations: [
          Migration.make({
            id: 1,
            name: "create-private-state",
            risk: "additive",
            providers: {
              Postgres: Migration.sqlBody(["CREATE TABLE private_state (id TEXT)"]),
            },
          }),
        ],
        layer: Layer.empty,
      });
      const result = yield* Registry.manifest({
        provider: D1Profile,
        capsules: [capsule],
      }).pipe(Effect.flip);
      assert.strictEqual(result._tag, "MissingProviderMigration");
    }),
  );

  it("resolves exact provider overrides before shared SQL dialect defaults", () => {
    const migration = Migration.make({
      id: 1,
      name: "provider-override",
      risk: "additive",
      providers: {
        Sqlite: Migration.sqlBody(["SELECT dialect"]),
        BunSqlite: Migration.sqlBody(["SELECT provider"]),
      },
    });
    const providerImplementation = Migration.resolveMigrationImplementation(
      migration,
      BunSqliteProfile,
    );
    const dialectImplementation = Migration.resolveMigrationImplementation(migration, D1Profile);
    if (providerImplementation?._tag !== "Sql" || dialectImplementation?._tag !== "Sql") {
      throw new Error("expected static SQL implementations");
    }
    assert.deepStrictEqual(providerImplementation.statements, ["SELECT provider"]);
    assert.deepStrictEqual(dialectImplementation.statements, ["SELECT dialect"]);
  });
});
