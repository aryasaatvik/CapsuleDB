import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { buildManifest, decodeManifest, validateManifest } from "../../src/Manifest.ts";
import {
  MigrationChecksumDrift,
  MigrationHistoryGap,
  MigrationHistoryReordered,
  MigrationNameDrift,
  ManifestFingerprintDrift,
  MissingProviderMigration,
  NamespaceCollision,
} from "../../src/Error.ts";
import { makeMigration, sqlMigrationBody } from "../../src/Migration.ts";
import { BunSqliteProfile } from "../../src/Provider.ts";
import { makeFixtureCapsule, makeFixtureMigration } from "../fixtures/migrations.ts";

const manifestErrorTag = (error: { readonly _tag: string }): string => error._tag;

describe("deterministic manifest integrity", () => {
  it.effect("reproduces one byte-identical manifest from identical sources", () =>
    Effect.gen(function* () {
      const migration = yield* makeFixtureMigration(
        1,
        "create-tokens",
        "CREATE TABLE tokens (id TEXT)",
      );
      const capsule = yield* makeFixtureCapsule([migration]);
      const first = yield* buildManifest({ capsules: [capsule] });
      const second = yield* buildManifest({ capsules: [capsule] });
      assert.deepStrictEqual(second, first);
      assert.strictEqual(second.fingerprint.length, 64);
      assert.strictEqual(second.capsules[0]?.migrations[0]?.providers.length, 4);
    }),
  );

  it.effect("fails source, name, and provider drift before mutation", () =>
    Effect.gen(function* () {
      const originalMigration = yield* makeFixtureMigration(
        1,
        "create-tokens",
        "CREATE TABLE tokens (id TEXT)",
      );
      const original = yield* makeFixtureCapsule([originalMigration]);
      const expected = yield* buildManifest({ capsules: [original] });

      const editedMigration = yield* makeFixtureMigration(
        1,
        "create-tokens",
        "CREATE TABLE tokens (id TEXT, value TEXT)",
      );
      const edited = yield* makeFixtureCapsule([editedMigration]);
      const checksumError = yield* validateManifest({
        capsules: [edited],
        expected,
      }).pipe(Effect.flip);
      assert.strictEqual(
        manifestErrorTag(checksumError),
        new MigrationChecksumDrift({
          migrationId: 1,
          expected: "a".repeat(64),
          actual: "b".repeat(64),
        })._tag,
      );

      const renamedMigration = yield* makeFixtureMigration(
        1,
        "create-private-tokens",
        "CREATE TABLE tokens (id TEXT)",
      );
      const renamed = yield* makeFixtureCapsule([renamedMigration]);
      const nameError = yield* validateManifest({ capsules: [renamed], expected }).pipe(
        Effect.flip,
      );
      assert.strictEqual(
        manifestErrorTag(nameError),
        new MigrationNameDrift({
          migrationId: 1,
          expected: "create-tokens",
          actual: "create-private-tokens",
        })._tag,
      );

      const sqliteOnly = yield* makeMigration({
        id: 1,
        name: "create-tokens",
        risk: "additive",
        providers: {
          Sqlite: sqlMigrationBody("CREATE TABLE tokens (id TEXT)", [
            "CREATE TABLE tokens (id TEXT)",
          ]),
        },
      });
      const sqliteOnlyCapsule = yield* makeFixtureCapsule([sqliteOnly]);
      const providerError = yield* validateManifest({
        capsules: [sqliteOnlyCapsule],
        expected,
        provider: { ...BunSqliteProfile, dialect: { _tag: "D1" } },
      }).pipe(Effect.flip);
      assert.strictEqual(
        manifestErrorTag(providerError),
        new MissingProviderMigration({
          migrationId: 1,
          dialect: "D1",
        })._tag,
      );
    }),
  );

  it.effect("rejects duplicate IDs, gaps, and reordered histories", () =>
    Effect.gen(function* () {
      const first = yield* makeFixtureMigration(1, "first", "CREATE TABLE first (id TEXT)");
      const duplicate = yield* makeFixtureMigration(
        1,
        "duplicate",
        "CREATE TABLE duplicate (id TEXT)",
      );
      const duplicateCapsule = yield* makeFixtureCapsule([first, duplicate]);
      const duplicateError = yield* buildManifest({ capsules: [duplicateCapsule] }).pipe(
        Effect.flip,
      );
      assert.strictEqual(manifestErrorTag(duplicateError), "DuplicateMigrationId");

      const third = yield* makeFixtureMigration(3, "third", "CREATE TABLE third (id TEXT)");
      const gapCapsule = yield* makeFixtureCapsule([first, third]);
      const gapError = yield* buildManifest({ capsules: [gapCapsule] }).pipe(Effect.flip);
      assert.strictEqual(
        manifestErrorTag(gapError),
        new MigrationHistoryGap({ expected: 2, actual: 3 })._tag,
      );

      const second = yield* makeFixtureMigration(2, "second", "CREATE TABLE second (id TEXT)");
      const reorderedCapsule = yield* makeFixtureCapsule([second, first]);
      const reorderedError = yield* buildManifest({ capsules: [reorderedCapsule] }).pipe(
        Effect.flip,
      );
      assert.strictEqual(
        manifestErrorTag(reorderedError),
        new MigrationHistoryReordered({ migrationId: 2, previousIndex: 0, nextIndex: 1 })._tag,
      );
    }),
  );

  it.effect("rejects namespace collisions and reads a manifest without functions", () =>
    Effect.gen(function* () {
      const firstMigration = yield* makeFixtureMigration(
        1,
        "first",
        "CREATE TABLE first (id TEXT)",
      );
      const first = yield* makeFixtureCapsule([firstMigration], "first");
      const second = yield* makeFixtureCapsule([firstMigration], "second");
      const colliding = Object.freeze({ ...second, namespace: first.namespace });
      const collisionError = yield* buildManifest({ capsules: [first, colliding] }).pipe(
        Effect.flip,
      );
      assert.strictEqual(
        manifestErrorTag(collisionError),
        new NamespaceCollision({
          namespace: first.namespace,
          capsules: ["first", "second"],
        })._tag,
      );

      const manifest = yield* buildManifest({ capsules: [first] });
      const encoded: unknown = JSON.parse(JSON.stringify(manifest));
      const decoded = yield* decodeManifest(encoded);
      assert.deepStrictEqual(decoded, manifest);
      assert.strictEqual(
        "execute" in (decoded.capsules[0]?.migrations[0]?.providers[0] ?? {}),
        false,
      );

      const tampered = { ...manifest, fingerprint: "0".repeat(64) };
      const fingerprintError = yield* decodeManifest(tampered).pipe(Effect.flip);
      assert.strictEqual(
        manifestErrorTag(fingerprintError),
        new ManifestFingerprintDrift({
          expected: "0".repeat(64),
          actual: manifest.fingerprint,
        })._tag,
      );
    }),
  );
});
