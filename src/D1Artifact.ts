import { Effect, Schema } from "effect";

import {
  D1ArtifactMigrationEdited,
  D1ArtifactMigrationMissing,
  D1ArtifactMigrationReordered,
  D1ArtifactStale,
  D1ArtifactUnsupportedBody,
  InvalidDefinition,
  MissingProviderMigration,
  type CapsuleError,
} from "./Error.ts";
import {
  decodeManifest,
  type Manifest,
  type ManifestCapsule,
  type ManifestError,
  type ManifestMigration,
} from "./Manifest.ts";
import { D1Profile } from "./Provider.ts";
import { sha256 } from "./internal/checksum.ts";

/** One immutable SQL file projected from one validated D1 migration body. */
export const D1ArtifactFile = Schema.Struct({
  path: Schema.String,
  capsuleId: Schema.String,
  namespace: Schema.String,
  migrationId: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  name: Schema.String,
  checksum: Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(64, 64), Schema.isPattern(/^[0-9a-f]{64}$/)),
  ),
  source: Schema.String,
  statements: Schema.Array(Schema.String),
});

export type D1ArtifactFile = typeof D1ArtifactFile.Type;

/** Deterministic, manifest-bound index for optional D1 SQL files. */
export const D1Artifact = Schema.Struct({
  version: Schema.Literal(1),
  manifestFingerprint: Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(64, 64), Schema.isPattern(/^[0-9a-f]{64}$/)),
  ),
  files: Schema.Array(D1ArtifactFile),
});

export type D1Artifact = typeof D1Artifact.Type;

/** Errors raised while deriving or checking optional D1 artifacts. */
export type D1ArtifactError =
  | ManifestError
  | CapsuleError
  | InvalidDefinition
  | MissingProviderMigration
  | D1ArtifactUnsupportedBody
  | D1ArtifactStale
  | D1ArtifactMigrationMissing
  | D1ArtifactMigrationReordered
  | D1ArtifactMigrationEdited;

const slug = (value: string): string =>
  value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const pathSegment = (value: string): string => encodeURIComponent(value);

const filePath = (capsule: ManifestCapsule, migration: ManifestMigration): string =>
  `${String(migration.id).padStart(4, "0")}-${pathSegment(capsule.namespace)}-${slug(migration.name)}.sql`;

const d1Body = (
  capsule: ManifestCapsule,
  migration: ManifestMigration,
): Effect.Effect<Extract<D1ArtifactFile, { readonly migrationId: number }>, D1ArtifactError> =>
  Effect.gen(function* () {
    const provider = migration.providers.find((candidate) => candidate.dialect === "D1");
    if (provider === undefined) {
      return yield* Effect.fail(
        new MissingProviderMigration({ migrationId: migration.id, dialect: "D1" }),
      );
    }
    if (provider._tag !== "Sql") {
      return yield* Effect.fail(
        new D1ArtifactUnsupportedBody({
          capsuleId: capsule.id,
          migrationId: migration.id,
          mode: provider._tag,
        }),
      );
    }

    // The artifact is a deployment aid for one static D1 body. Runtime
    // preparation still performs its own claim-first batch and limits check.
    const capabilities = D1Profile.capabilities;
    if (capabilities._tag !== "AtomicBatch") {
      return yield* Effect.fail(
        new InvalidDefinition({
          subject: "D1 artifact profile",
          reason: "the built-in D1 profile is not atomic-batch capable",
        }),
      );
    }
    // Runtime preparation prepends one ledger claim to this body. Keep the
    // static projection within that same complete claim-first batch limit.
    const maxBodyStatements = capabilities.maxStatements - 1;
    if (provider.statements.length > maxBodyStatements) {
      return yield* Effect.fail(
        new InvalidDefinition({
          subject: `D1 artifact ${capsule.id}/${migration.id}`,
          reason: `D1 migration has ${provider.statements.length} body statements; runtime claim-first batches allow at most ${maxBodyStatements}`,
        }),
      );
    }
    const maxSqlStatementBytes = capabilities.maxSqlStatementBytes;
    if (
      maxSqlStatementBytes !== undefined &&
      provider.statements.some(
        (statement) => new TextEncoder().encode(statement).byteLength > maxSqlStatementBytes,
      )
    ) {
      return yield* Effect.fail(
        new InvalidDefinition({
          subject: `D1 artifact ${capsule.id}/${migration.id}`,
          reason: `D1 migration contains a statement larger than ${maxSqlStatementBytes} bytes`,
        }),
      );
    }

    return {
      path: filePath(capsule, migration),
      capsuleId: capsule.id,
      namespace: capsule.namespace,
      migrationId: migration.id,
      name: migration.name,
      checksum: migration.checksum,
      source: provider.statements.join("\n"),
      statements: [...provider.statements],
    };
  });

/** Build the deterministic optional D1 projection from a verified manifest. */
export const buildD1Artifact = (manifest: Manifest): Effect.Effect<D1Artifact, D1ArtifactError> =>
  Effect.gen(function* () {
    const verified = yield* decodeManifest(manifest);
    const files: Array<D1ArtifactFile> = [];
    const paths = new Set<string>();
    for (const capsule of verified.capsules) {
      for (const migration of capsule.migrations) {
        const file = yield* d1Body(capsule, migration);
        if (paths.has(file.path)) {
          return yield* Effect.fail(
            new InvalidDefinition({
              subject: "D1 artifact",
              reason: `duplicate output path ${file.path}`,
            }),
          );
        }
        paths.add(file.path);
        files.push(file);
      }
    }
    return {
      version: 1 as const,
      manifestFingerprint: verified.fingerprint,
      files,
    };
  });

/** Encode an artifact index with stable indentation and a trailing newline. */
export const stringifyD1Artifact = (artifact: D1Artifact): string =>
  `${JSON.stringify(artifact, null, 2)}\n`;

/** Render one D1 SQL file without adding dynamic runtime migration behavior. */
export const renderD1ArtifactFile = (file: D1ArtifactFile): string =>
  [
    "-- Generated by CapsuleDB; runtime Registry.prepare remains canonical.",
    `-- capsule: ${file.capsuleId}`,
    `-- migration: ${file.migrationId} (${file.name})`,
    `-- checksum: ${file.checksum}`,
    ...file.statements,
    "",
  ].join("\n");

const decodeArtifact = (input: unknown): Effect.Effect<D1Artifact, InvalidDefinition> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(D1Artifact)(input),
    catch: (cause) =>
      new InvalidDefinition({
        subject: "D1 artifact",
        reason: String(cause),
      }),
  });

/** Parse an artifact index before checking its relationship to a manifest. */
export const decodeD1Artifact = (input: unknown): Effect.Effect<D1Artifact, InvalidDefinition> =>
  decodeArtifact(input);

/**
 * Verify that an artifact is the exact ordered projection of a manifest.
 * Missing, reordered, edited, unsupported, and stale projections fail closed.
 */
export const validateD1Artifact = (options: {
  readonly manifest: Manifest;
  readonly artifact: unknown;
}): Effect.Effect<D1Artifact, D1ArtifactError> =>
  Effect.gen(function* () {
    const artifact = yield* decodeArtifact(options.artifact);
    const manifest = yield* decodeManifest(options.manifest);
    if (artifact.manifestFingerprint !== manifest.fingerprint) {
      return yield* Effect.fail(
        new D1ArtifactStale({
          expectedFingerprint: manifest.fingerprint,
          actualFingerprint: artifact.manifestFingerprint,
        }),
      );
    }

    const expected = yield* buildD1Artifact(manifest);
    const actualPaths = artifact.files.map((file) => file.path);
    for (let index = 0; index < expected.files.length; index += 1) {
      const expectedFile = expected.files[index];
      if (expectedFile === undefined) continue;
      const actualFile = artifact.files[index];
      if (actualFile === undefined) {
        return yield* Effect.fail(
          new D1ArtifactMigrationMissing({
            capsuleId: expectedFile.capsuleId,
            migrationId: expectedFile.migrationId,
            path: expectedFile.path,
          }),
        );
      }
      if (actualFile.path !== expectedFile.path) {
        const actualIndex = actualPaths.indexOf(expectedFile.path);
        if (actualIndex >= 0) {
          return yield* Effect.fail(
            new D1ArtifactMigrationReordered({
              capsuleId: expectedFile.capsuleId,
              migrationId: expectedFile.migrationId,
              expectedIndex: index,
              actualIndex,
            }),
          );
        }
        return yield* Effect.fail(
          new D1ArtifactMigrationMissing({
            capsuleId: expectedFile.capsuleId,
            migrationId: expectedFile.migrationId,
            path: expectedFile.path,
          }),
        );
      }
      if (JSON.stringify(actualFile) !== JSON.stringify(expectedFile)) {
        return yield* Effect.fail(
          new D1ArtifactMigrationEdited({
            capsuleId: expectedFile.capsuleId,
            migrationId: expectedFile.migrationId,
            expectedChecksum: expectedFile.checksum,
            actualChecksum: actualFile.checksum,
          }),
        );
      }
    }
    if (artifact.files.length > expected.files.length) {
      const extra = artifact.files[expected.files.length];
      if (extra !== undefined) {
        return yield* Effect.fail(
          new D1ArtifactMigrationEdited({
            capsuleId: extra.capsuleId,
            migrationId: extra.migrationId,
            expectedChecksum: "missing",
            actualChecksum: extra.checksum,
          }),
        );
      }
    }
    return artifact;
  });

/** Compute a deterministic checksum for a rendered SQL artifact file. */
export const checksumD1ArtifactFile = (file: D1ArtifactFile): Effect.Effect<string, never> =>
  sha256(renderD1ArtifactFile(file)).pipe(Effect.orDie);
