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
    const step = Migration.sql({ sqlite: ["SELECT 1"], postgres: ["SELECT 1"] });
    assert.throws(
      () => Migration.make({ id: 0, name: "zero-id", risk: "additive", steps: [step] }),
      CapsuleDefinitionError,
    );
    assert.throws(
      () => Migration.make({ id: 1, name: "no-steps", risk: "additive", steps: [] }),
      CapsuleDefinitionError,
    );
    assert.throws(
      () =>
        Migration.make({
          id: 1,
          name: "empty-body",
          risk: "additive",
          steps: [Migration.sql({ sqlite: [] })],
        }),
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
            steps: [Migration.sql({ postgres: ["CREATE TABLE private_state (id TEXT)"] })],
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

  it("resolves one dialect body per migration and coalesces adjacent SQL steps", () => {
    const migration = Migration.make({
      id: 1,
      name: "mixed-steps",
      risk: "additive",
      steps: [
        Migration.sql({ sqlite: ["SELECT sqlite"], postgres: ["SELECT postgres"] }),
        Migration.sql({ sqlite: ["SELECT second"], postgres: ["SELECT second"] }),
      ],
    });

    assert.deepStrictEqual(Migration.resolve(migration, "sqlite"), [
      { _tag: "Sql", statements: ["SELECT sqlite", "SELECT second"] },
    ]);
    assert.deepStrictEqual(Migration.resolve(migration, "postgres"), [
      { _tag: "Sql", statements: ["SELECT postgres", "SELECT second"] },
    ]);
    assert.deepStrictEqual(Migration.supportedDialects(migration), ["postgres", "sqlite"]);
  });

  it("reports the dialects a migration supports and refuses one that supports none", () => {
    const postgresOnly = Migration.make({
      id: 1,
      name: "postgres-only",
      risk: "additive",
      steps: [Migration.sql({ postgres: ["SELECT 1"] })],
    });
    assert.deepStrictEqual(Migration.supportedDialects(postgresOnly), ["postgres"]);
    assert.strictEqual(Migration.resolve(postgresOnly, "sqlite"), undefined);

    assert.throws(
      () =>
        Migration.make({
          id: 1,
          name: "no-dialect",
          risk: "additive",
          steps: [
            Migration.sql({ postgres: ["SELECT 1"] }),
            Migration.sql({ sqlite: ["SELECT 1"] }),
          ],
        }),
      CapsuleDefinitionError,
    );
  });
});
