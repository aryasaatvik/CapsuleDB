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
import * as Migration from "../../src/Migration.ts";
import { PostgresProfile } from "../../src/Provider.ts";
import { makeFixtureCapsule, makeFixtureMigration } from "../fixtures/migrations.ts";

const manifestErrorTag = (error: { readonly _tag: string }): string => error._tag;

describe("deterministic manifest integrity", () => {
  it.effect("reproduces one byte-identical manifest from identical sources", () =>
    Effect.gen(function* () {
      const migration = makeFixtureMigration(1, "create-tokens", "CREATE TABLE tokens (id TEXT)");
      const capsule = makeFixtureCapsule([migration]);
      const first = yield* buildManifest({ capsules: [capsule] });
      const second = yield* buildManifest({ capsules: [capsule] });
      assert.deepStrictEqual(second, first);
      assert.strictEqual(second.fingerprint.length, 64);
      assert.strictEqual(second.capsules[0]?.migrations[0]?.bodies.length, 2);
    }),
  );

  it.effect("fails source, name, and provider drift before mutation", () =>
    Effect.gen(function* () {
      const originalMigration = makeFixtureMigration(
        1,
        "create-tokens",
        "CREATE TABLE tokens (id TEXT)",
      );
      const original = makeFixtureCapsule([originalMigration]);
      const expected = yield* buildManifest({ capsules: [original] });

      const editedMigration = makeFixtureMigration(
        1,
        "create-tokens",
        "CREATE TABLE tokens (id TEXT, value TEXT)",
      );
      const edited = makeFixtureCapsule([editedMigration]);
      const checksumError = yield* validateManifest({
        capsules: [edited],
        expected,
      }).pipe(Effect.flip);
      assert.strictEqual(
        manifestErrorTag(checksumError),
        new MigrationChecksumDrift({
          migrationId: 1,
          dialect: "postgres",
          expected: "a".repeat(64),
          actual: "b".repeat(64),
        })._tag,
      );

      const renamedMigration = makeFixtureMigration(
        1,
        "create-private-tokens",
        "CREATE TABLE tokens (id TEXT)",
      );
      const renamed = makeFixtureCapsule([renamedMigration]);
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

      const sqliteOnly = Migration.make({
        id: 1,
        name: "create-tokens",
        risk: "additive",
        steps: [Migration.sql({ sqlite: ["CREATE TABLE tokens (id TEXT)"] })],
      });
      const sqliteOnlyCapsule = makeFixtureCapsule([sqliteOnly]);
      const providerError = yield* validateManifest({
        capsules: [sqliteOnlyCapsule],
        expected,
        provider: PostgresProfile,
      }).pipe(Effect.flip);
      assert.strictEqual(
        manifestErrorTag(providerError),
        new MissingProviderMigration({ migrationId: 1, dialect: "postgres" })._tag,
      );
    }),
  );

  it.effect("rejects duplicate IDs, gaps, and reordered histories", () =>
    Effect.gen(function* () {
      const first = makeFixtureMigration(1, "first", "CREATE TABLE first (id TEXT)");
      const duplicate = makeFixtureMigration(1, "duplicate", "CREATE TABLE duplicate (id TEXT)");
      const duplicateCapsule = makeFixtureCapsule([first, duplicate]);
      const duplicateError = yield* buildManifest({ capsules: [duplicateCapsule] }).pipe(
        Effect.flip,
      );
      assert.strictEqual(manifestErrorTag(duplicateError), "DuplicateMigrationId");

      const third = makeFixtureMigration(3, "third", "CREATE TABLE third (id TEXT)");
      const gapCapsule = makeFixtureCapsule([first, third]);
      const gapError = yield* buildManifest({ capsules: [gapCapsule] }).pipe(Effect.flip);
      assert.strictEqual(
        manifestErrorTag(gapError),
        new MigrationHistoryGap({ expected: 2, actual: 3 })._tag,
      );

      const second = makeFixtureMigration(2, "second", "CREATE TABLE second (id TEXT)");
      const reorderedCapsule = makeFixtureCapsule([second, first]);
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
      const firstMigration = makeFixtureMigration(1, "first", "CREATE TABLE first (id TEXT)");
      const first = makeFixtureCapsule([firstMigration], "first");
      const second = makeFixtureCapsule([firstMigration], "second");
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
        "execute" in (decoded.capsules[0]?.migrations[0]?.bodies[0]?.operations[0] ?? {}),
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
