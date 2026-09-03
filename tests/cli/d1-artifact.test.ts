import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildD1Artifact, renderD1ArtifactFile, validateD1Artifact } from "../../src/D1Artifact.ts";
import { buildManifest } from "../../src/Manifest.ts";
import * as Migration from "../../src/Migration.ts";
import * as Capsule from "../../src/Capsule.ts";
import { D1Profile } from "../../src/Provider.ts";

const makeStaticManifest = (migrationCount = 1) =>
  Effect.gen(function* () {
    const migrations = [];
    for (let id = 1; id <= migrationCount; id += 1) {
      const tableName = `artifact_table_${id}`;
      migrations.push(
        Migration.make({
          id,
          name: `create-artifact-table-${id}`,
          risk: "additive",
          providers: {
            D1: Migration.sqlBody([`CREATE TABLE "${tableName}" (id TEXT NOT NULL)`]),
          },
        }),
      );
    }
    const capsule = Capsule.make({
      id: "artifact.fixture",
      migrations,
      layer: Layer.empty,
    });
    return yield* buildManifest({ capsules: [capsule] });
  });

describe("D1 artifact projection", () => {
  it.effect("round-trips the static D1 body and rejects every drift class", () =>
    Effect.gen(function* () {
      const manifest = yield* makeStaticManifest(2);
      const artifact = yield* buildD1Artifact(manifest);
      assert.strictEqual(artifact.files.length, 2);
      assert.strictEqual(
        artifact.files[0]?.statements[0],
        'CREATE TABLE "artifact_table_1" (id TEXT NOT NULL)',
      );
      assert.deepStrictEqual(yield* validateD1Artifact({ manifest, artifact }), artifact);

      const stale = yield* validateD1Artifact({
        manifest,
        artifact: { ...artifact, manifestFingerprint: "0".repeat(64) },
      }).pipe(Effect.flip);
      assert.strictEqual(stale._tag, "D1ArtifactStale");

      const file = artifact.files[0];
      if (file === undefined) throw new Error("artifact is empty");
      const edited = yield* validateD1Artifact({
        manifest,
        artifact: { ...artifact, files: [{ ...file, statements: ["edited"] }] },
      }).pipe(Effect.flip);
      assert.strictEqual(edited._tag, "D1ArtifactMigrationEdited");

      const missing = yield* validateD1Artifact({
        manifest,
        artifact: { ...artifact, files: [file] },
      }).pipe(Effect.flip);
      assert.strictEqual(missing._tag, "D1ArtifactMigrationMissing");

      const secondFile = artifact.files[1];
      if (secondFile === undefined) throw new Error("artifact is missing its second migration");
      const reordered = yield* validateD1Artifact({
        manifest,
        artifact: { ...artifact, files: [secondFile, file] },
      }).pipe(Effect.flip);
      assert.strictEqual(reordered._tag, "D1ArtifactMigrationReordered");
    }),
  );

  it.effect("rejects dynamic D1 bodies instead of serializing functions", () =>
    Effect.gen(function* () {
      const migration = Migration.make({
        id: 1,
        name: "dynamic",
        risk: "additive",
        providers: { D1: Migration.effectBody("dynamic", Effect.void) },
      });
      const capsule = Capsule.make({
        id: "artifact.dynamic",
        migrations: [migration],
        layer: Layer.empty,
      });
      const manifest = yield* buildManifest({ capsules: [capsule] });
      const failure = yield* buildD1Artifact(manifest).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "D1ArtifactUnsupportedBody");
      assert.strictEqual(D1Profile.capabilities._tag, "AtomicBatch");
    }),
  );

  it.effect("mirrors claim-first batch limits and keeps namespace paths injective", () =>
    Effect.gen(function* () {
      const oversizedMigration = Migration.make({
        id: 1,
        name: "two-statements",
        risk: "additive",
        providers: {
          D1: Migration.sqlBody(["SELECT 1", "SELECT 2"]),
        },
      });
      const oversizedCapsule = Capsule.make({
        id: "artifact.oversized",
        migrations: [oversizedMigration],
        layer: Layer.empty,
      });
      const oversizedManifest = yield* buildManifest({ capsules: [oversizedCapsule] });
      const oversizedFailure = yield* buildD1Artifact(oversizedManifest).pipe(Effect.flip);
      assert.strictEqual(oversizedFailure._tag, "InvalidDefinition");

      const firstMigration = Migration.make({
        id: 1,
        name: "same-migration",
        risk: "additive",
        providers: { D1: Migration.sqlBody(["SELECT 1"]) },
      });
      const secondMigration = Migration.make({
        id: 1,
        name: "same-migration",
        risk: "additive",
        providers: { D1: Migration.sqlBody(["SELECT 2"]) },
      });
      const firstCapsule = Capsule.make({
        id: "a.b",
        migrations: [firstMigration],
        layer: Layer.empty,
      });
      const secondCapsule = Capsule.make({
        id: "a-b",
        migrations: [secondMigration],
        layer: Layer.empty,
      });
      const manifest = yield* buildManifest({ capsules: [firstCapsule, secondCapsule] });
      const artifact = yield* buildD1Artifact(manifest);
      const paths = artifact.files.map((file) => file.path);
      assert.strictEqual(new Set(paths).size, paths.length);
      assert.strictEqual(
        paths.some((path) => path.includes("capsule_a_2e_b")),
        true,
      );
      assert.strictEqual(
        paths.some((path) => path.includes("capsule_a_2d_b")),
        true,
      );
    }),
  );

  it.effect("keeps generated SQL files exactly tied to the artifact index", () =>
    Effect.gen(function* () {
      const manifest = yield* makeStaticManifest();
      const artifact = yield* buildD1Artifact(manifest);
      const file = artifact.files[0];
      if (file === undefined) throw new Error("artifact is empty");
      assert.strictEqual(renderD1ArtifactFile(file).endsWith("\n"), true);
      const directory = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), "capsuledb-d1-artifact-")),
      );
      yield* Effect.tryPromise(() =>
        writeFile(join(directory, file.path), renderD1ArtifactFile(file)),
      );
      assert.deepStrictEqual(yield* Effect.tryPromise(() => readdir(directory)), [file.path]);
      assert.strictEqual(
        yield* Effect.tryPromise(() => readFile(join(directory, file.path), "utf8")),
        renderD1ArtifactFile(file),
      );
    }),
  );
});
