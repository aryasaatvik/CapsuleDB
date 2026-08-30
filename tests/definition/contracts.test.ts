import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { deriveNamespace, makeCapsule } from "../../src/Capsule.ts";
import { DuplicateCapsule, NamespaceCollision, UnsupportedCapability } from "../../src/Error.ts";
import {
  makeMigration,
  resolveMigrationImplementation,
  sqlMigrationBody,
} from "../../src/Migration.ts";
import { BunSqliteProfile, D1Profile, makeProviderProfile } from "../../src/Provider.ts";
import { makeRegistry } from "../../src/Registry.ts";

const noopCapsule = (id: string) =>
  makeCapsule({
    id,
    migrations: [],
    layer: Layer.empty,
  });

describe("CapsuleDB definition contracts", () => {
  it.effect("derives one stable namespace from a validated capsule ID", () =>
    Effect.gen(function* () {
      const capsule = yield* noopCapsule("reference.tokens");
      assert.strictEqual(capsule.namespace, deriveNamespace(capsule.id));
      assert.notStrictEqual(capsule.namespace, "reference.tokens");
    }),
  );

  it.effect("fails invalid IDs through the typed definition channel", () =>
    Effect.gen(function* () {
      const result = yield* noopCapsule("Not valid").pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined,
        }),
      );
      assert.strictEqual(result?._tag, "InvalidCapsuleId");
    }),
  );

  it.effect("rejects duplicate IDs and physical namespace collisions", () =>
    Effect.gen(function* () {
      const first = yield* noopCapsule("first");
      const duplicate = yield* noopCapsule("first");
      const duplicateResult = yield* makeRegistry({
        provider: BunSqliteProfile,
        capsules: [first, duplicate],
      }).pipe(Effect.flip);
      assert.strictEqual(duplicateResult._tag, new DuplicateCapsule({ capsuleId: "first" })._tag);

      const second = yield* noopCapsule("second");
      const collision = Object.freeze({ ...second, namespace: first.namespace });
      const collisionResult = yield* makeRegistry({
        provider: BunSqliteProfile,
        capsules: [first, collision],
      }).pipe(Effect.flip);
      assert.strictEqual(
        collisionResult._tag,
        new NamespaceCollision({
          namespace: first.namespace,
          capsules: ["first", "second"],
        })._tag,
      );
    }),
  );

  it.effect("does not allow D1 to advertise transactional execution", () =>
    Effect.gen(function* () {
      const result = yield* makeProviderProfile({
        provider: D1Profile.provider,
        dialect: D1Profile.dialect,
        capabilities: BunSqliteProfile.capabilities,
      }).pipe(Effect.flip);
      assert.strictEqual(
        result._tag,
        new UnsupportedCapability({
          dialect: "d1",
          capability: "interactive transactions, savepoints, streaming, or Effect migrations",
        })._tag,
      );
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
      const migration = yield* makeMigration({
        id: 1,
        name: "create-private-state",
        risk: "additive",
        providers: {
          Postgres: sqlMigrationBody(["CREATE TABLE private_state (id TEXT)"]),
        },
      });
      const capsule = yield* makeCapsule({
        id: "private.state",
        migrations: [migration],
        layer: Layer.empty,
      });
      const result = yield* makeRegistry({ provider: D1Profile, capsules: [capsule] }).pipe(
        Effect.flip,
      );
      assert.strictEqual(result._tag, "MissingProviderMigration");
    }),
  );

  it.effect("resolves exact provider overrides before shared SQL dialect defaults", () =>
    Effect.gen(function* () {
      const migration = yield* makeMigration({
        id: 1,
        name: "provider-override",
        risk: "additive",
        providers: {
          Sqlite: sqlMigrationBody(["SELECT dialect"]),
          BunSqlite: sqlMigrationBody(["SELECT provider"]),
        },
      });
      const providerImplementation = resolveMigrationImplementation(migration, BunSqliteProfile);
      const dialectImplementation = resolveMigrationImplementation(migration, D1Profile);
      if (providerImplementation?._tag !== "Sql" || dialectImplementation?._tag !== "Sql") {
        throw new Error("expected static SQL implementations");
      }
      assert.deepStrictEqual(providerImplementation.statements, ["SELECT provider"]);
      assert.deepStrictEqual(dialectImplementation.statements, ["SELECT dialect"]);
    }),
  );
});
