import { Effect, Schema } from "effect";

import type { Capsule } from "./Capsule.ts";
import {
  DuplicateCapsule,
  DuplicateMigrationId,
  InvalidDefinition,
  ManifestFingerprintDrift,
  MigrationChecksumDrift,
  MigrationHistoryGap,
  MigrationHistoryReordered,
  MigrationNameDrift,
  MissingProviderMigration,
  NamespaceCollision,
  ProviderMismatch,
} from "./Error.ts";
import { resolve, supportedDialects, type Migration, type Operation } from "./Migration.ts";
import type { Dialect } from "./Dialect.ts";
import type { ProviderProfile } from "./Provider.ts";
import { sha256 } from "./internal/checksum.ts";

/** A lowercase SHA-256 checksum of canonical authored migration metadata. */
export const Checksum = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(64, 64), Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Checksum"),
);

export type Checksum = typeof Checksum.Type;

const ManifestDialect = Schema.Union([Schema.Literal("postgres"), Schema.Literal("sqlite")]);

/** Runtime-readable migration work; Effect bodies keep only their revision. */
export const ManifestOperation = Schema.TaggedUnion({
  Sql: {
    statements: Schema.Array(Schema.String),
  },
  Effect: {
    revision: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  },
});

export type ManifestOperation = typeof ManifestOperation.Type;

/** The ordered work one dialect applies for one logical migration. */
export const ManifestBody = Schema.Struct({
  dialect: ManifestDialect,
  operations: Schema.Array(ManifestOperation),
});

export type ManifestBody = typeof ManifestBody.Type;

/** One logical migration's checksum and per-dialect bodies. */
export const ManifestMigration = Schema.Struct({
  id: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)), Schema.brand("MigrationId")),
  name: Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(128),
      Schema.isPattern(/^[a-z][a-z0-9._-]*$/),
    ),
    Schema.brand("MigrationName"),
  ),
  risk: Schema.Union([Schema.Literal("additive"), Schema.Literal("destructive")]),
  checksum: Checksum,
  bodies: Schema.Array(ManifestBody),
});

export type ManifestMigration = typeof ManifestMigration.Type;

/** A capsule's namespaced logical migration history. */
export const ManifestCapsule = Schema.Struct({
  id: Schema.String,
  namespace: Schema.String,
  migrations: Schema.Array(ManifestMigration),
});

export type ManifestCapsule = typeof ManifestCapsule.Type;

/** The complete static manifest persisted and read by runtime preparation. */
export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  fingerprint: Checksum,
  capsules: Schema.Array(ManifestCapsule),
});

export type Manifest = typeof Manifest.Type;

export interface ManifestBuildOptions {
  readonly capsules: ReadonlyArray<Capsule<never, unknown, unknown>>;
}

export interface ManifestValidationOptions extends ManifestBuildOptions {
  readonly expected: Manifest;
  readonly provider?: ProviderProfile;
}

export type ManifestError =
  | InvalidDefinition
  | DuplicateCapsule
  | NamespaceCollision
  | DuplicateMigrationId
  | MigrationHistoryGap
  | MigrationHistoryReordered
  | MigrationNameDrift
  | MigrationChecksumDrift
  | ManifestFingerprintDrift
  | MissingProviderMigration
  | ProviderMismatch;

const manifestOperation = (operation: Operation): ManifestOperation =>
  operation._tag === "Sql"
    ? { _tag: "Sql", statements: [...operation.statements] }
    : { _tag: "Effect", revision: operation.revision };

const manifestBodies = (migration: Migration): ReadonlyArray<ManifestBody> =>
  supportedDialects(migration)
    .map((dialect) => ({
      dialect,
      operations: (resolve(migration, dialect) ?? []).map(manifestOperation),
    }))
    .filter((body) => body.operations.length > 0);

const canonicalOperation = (operation: ManifestOperation): Readonly<Record<string, unknown>> =>
  operation._tag === "Sql"
    ? { mode: operation._tag, statements: operation.statements }
    : { mode: operation._tag, revision: operation.revision };

const canonicalBodies = (bodies: ReadonlyArray<ManifestBody>) =>
  [...bodies]
    .sort((left, right) => left.dialect.localeCompare(right.dialect))
    .map((body) => ({
      dialect: body.dialect,
      operations: body.operations.map(canonicalOperation),
    }));

const canonicalMigration = (
  capsuleId: string,
  migration: Pick<Migration, "id" | "name" | "risk">,
  bodies: ReadonlyArray<ManifestBody>,
) =>
  JSON.stringify({
    capsuleId,
    migrationId: migration.id,
    name: migration.name,
    risk: migration.risk,
    bodies: canonicalBodies(bodies),
  });

const canonicalManifestMigration = (capsuleId: string, migration: ManifestMigration): string =>
  canonicalMigration(capsuleId, migration, migration.bodies);

const canonicalManifest = (version: 1, capsules: ReadonlyArray<ManifestCapsule>): string =>
  JSON.stringify({
    version,
    capsules: capsules.map((capsule) => ({
      id: capsule.id,
      namespace: capsule.namespace,
      migrations: capsule.migrations.map((migration) => ({
        id: migration.id,
        name: migration.name,
        risk: migration.risk,
        checksum: migration.checksum,
        bodies: canonicalBodies(migration.bodies),
      })),
    })),
  });

const decodeManifestMigration = (
  input: unknown,
): Effect.Effect<ManifestMigration, InvalidDefinition> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(ManifestMigration)(input),
    catch: (cause) =>
      new InvalidDefinition({
        subject: "manifest migration",
        reason: String(cause),
      }),
  });

const validateCapsuleMigrations = (
  capsule: Capsule<never, unknown, unknown>,
): Effect.Effect<void, ManifestError> =>
  Effect.gen(function* () {
    const ids = capsule.migrations.map((migration) => migration.id);
    const sorted = [...ids].sort((left, right) => left - right);

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (id === undefined) continue;
      if (ids.indexOf(id) !== index) {
        return yield* Effect.fail(new DuplicateMigrationId({ migrationId: id }));
      }
      if (id !== sorted[index]) {
        return yield* Effect.fail(
          new MigrationHistoryReordered({
            migrationId: id,
            previousIndex: index,
            nextIndex: sorted.indexOf(id),
          }),
        );
      }
      const expected = index + 1;
      if (id !== expected) {
        return yield* Effect.fail(new MigrationHistoryGap({ expected, actual: id }));
      }
    }

    for (const migration of capsule.migrations) {
      if (manifestBodies(migration).length === 0) {
        return yield* Effect.fail(
          new InvalidDefinition({
            subject: `migration ${migration.id}`,
            reason: "no dialect can apply every step of this migration",
          }),
        );
      }
    }
  });

const validateCapsuleIdentity = (
  capsules: ReadonlyArray<Capsule<never, unknown, unknown>>,
): Effect.Effect<void, ManifestError> =>
  Effect.gen(function* () {
    for (let index = 0; index < capsules.length; index += 1) {
      const capsule = capsules[index];
      if (capsule === undefined) continue;
      const duplicateId = capsules.find(
        (candidate, candidateIndex) => candidateIndex < index && candidate.id === capsule.id,
      );
      if (duplicateId !== undefined) {
        return yield* Effect.fail(new DuplicateCapsule({ capsuleId: capsule.id }));
      }
    }
    for (let index = 0; index < capsules.length; index += 1) {
      const capsule = capsules[index];
      if (capsule === undefined) continue;
      const peers = capsules.filter(
        (candidate, candidateIndex) =>
          candidateIndex !== index && candidate.namespace === capsule.namespace,
      );
      if (peers.length > 0) {
        return yield* Effect.fail(
          new NamespaceCollision({
            namespace: capsule.namespace,
            capsules: [capsule.id, ...peers.map((peer) => peer.id)],
          }),
        );
      }
    }
  });

/** Build a deterministic manifest from explicit in-memory migration bodies. */
export const buildManifest = (
  options: ManifestBuildOptions,
): Effect.Effect<Manifest, ManifestError> =>
  Effect.gen(function* () {
    yield* validateCapsuleIdentity(options.capsules);

    const capsules: Array<ManifestCapsule> = [];
    for (const capsule of options.capsules) {
      yield* validateCapsuleMigrations(capsule);
      const migrations: Array<ManifestMigration> = [];
      for (const migration of capsule.migrations) {
        const bodies = manifestBodies(migration);
        const checksum = yield* sha256(canonicalMigration(capsule.id, migration, bodies));
        migrations.push(
          yield* decodeManifestMigration({
            id: migration.id,
            name: migration.name,
            risk: migration.risk,
            checksum,
            bodies,
          }),
        );
      }
      capsules.push({
        id: capsule.id,
        namespace: capsule.namespace,
        migrations,
      });
    }

    capsules.sort((left, right) => left.id.localeCompare(right.id));
    const withoutFingerprint = {
      version: 1 as const,
      capsules,
    };
    const fingerprint = yield* sha256(canonicalManifest(withoutFingerprint.version, capsules));
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Manifest)({ ...withoutFingerprint, fingerprint }),
      catch: (cause) =>
        new InvalidDefinition({
          subject: "manifest",
          reason: String(cause),
        }),
    });
  });

const validatePublishedStructure = (manifest: Manifest): Effect.Effect<void, ManifestError> =>
  Effect.gen(function* () {
    for (let capsuleIndex = 0; capsuleIndex < manifest.capsules.length; capsuleIndex += 1) {
      const capsule = manifest.capsules[capsuleIndex];
      if (capsule === undefined) continue;
      if (
        manifest.capsules.findIndex((candidate) => candidate.id === capsule.id) !== capsuleIndex
      ) {
        return yield* Effect.fail(new DuplicateCapsule({ capsuleId: capsule.id }));
      }
      const firstNamespaceIndex = manifest.capsules.findIndex(
        (candidate) => candidate.namespace === capsule.namespace,
      );
      if (firstNamespaceIndex !== capsuleIndex) {
        return yield* Effect.fail(
          new NamespaceCollision({
            namespace: capsule.namespace,
            capsules: [capsule.id, manifest.capsules[firstNamespaceIndex]?.id ?? capsule.id],
          }),
        );
      }

      let previousId = 0;
      const seenMigrationIds = new Set<number>();
      for (
        let migrationIndex = 0;
        migrationIndex < capsule.migrations.length;
        migrationIndex += 1
      ) {
        const migration = capsule.migrations[migrationIndex];
        if (migration === undefined) continue;
        if (seenMigrationIds.has(migration.id)) {
          return yield* Effect.fail(new DuplicateMigrationId({ migrationId: migration.id }));
        }
        seenMigrationIds.add(migration.id);
        if (migration.id <= previousId) {
          return yield* Effect.fail(
            new MigrationHistoryReordered({
              migrationId: migration.id,
              previousIndex: migrationIndex,
              nextIndex: migrationIndex,
            }),
          );
        }
        const expected = migrationIndex + 1;
        if (migration.id !== expected) {
          return yield* Effect.fail(new MigrationHistoryGap({ expected, actual: migration.id }));
        }
        previousId = migration.id;

        if (migration.bodies.length === 0) {
          return yield* Effect.fail(
            new InvalidDefinition({
              subject: `manifest migration ${migration.id}`,
              reason: "at least one dialect body is required",
            }),
          );
        }
        for (let bodyIndex = 0; bodyIndex < migration.bodies.length; bodyIndex += 1) {
          const body = migration.bodies[bodyIndex];
          if (body === undefined) continue;
          if (
            migration.bodies.findIndex((candidate) => candidate.dialect === body.dialect) !==
            bodyIndex
          ) {
            return yield* Effect.fail(
              new InvalidDefinition({
                subject: `manifest migration ${migration.id} bodies`,
                reason: `duplicate dialect ${body.dialect}`,
              }),
            );
          }
        }
      }
    }
  });

const verifyManifest = (manifest: Manifest): Effect.Effect<Manifest, ManifestError> =>
  Effect.gen(function* () {
    yield* validatePublishedStructure(manifest);
    for (const capsule of manifest.capsules) {
      for (const migration of capsule.migrations) {
        const actual = yield* sha256(canonicalManifestMigration(capsule.id, migration));
        if (actual !== migration.checksum) {
          return yield* Effect.fail(
            new MigrationChecksumDrift({
              expected: actual,
              actual: migration.checksum,
              migrationId: migration.id,
            }),
          );
        }
      }
    }
    const actual = yield* sha256(canonicalManifest(manifest.version, manifest.capsules));
    if (actual !== manifest.fingerprint) {
      return yield* Effect.fail(
        new ManifestFingerprintDrift({
          expected: manifest.fingerprint,
          actual,
        }),
      );
    }
    return manifest;
  });

/** Parse and verify a published manifest before it is used for preparation. */
export const decodeManifest = (input: unknown): Effect.Effect<Manifest, ManifestError> =>
  Effect.gen(function* () {
    const manifest = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Manifest)(input),
      catch: (cause) =>
        new InvalidDefinition({
          subject: "published manifest",
          reason: String(cause),
        }),
    });
    return yield* verifyManifest(manifest);
  });

const validateProviderBodies = (
  capsules: ReadonlyArray<Capsule<never, unknown, unknown>>,
  provider: ProviderProfile,
): Effect.Effect<void, ManifestError> =>
  Effect.gen(function* () {
    for (const capsule of capsules) {
      for (const migration of capsule.migrations) {
        const operations = resolve(migration, provider.dialect);
        if (operations === undefined) {
          return yield* Effect.fail(
            new MissingProviderMigration({
              migrationId: migration.id,
              dialect: provider.dialect,
            }),
          );
        }
        if (
          provider.capabilities._tag === "AtomicBatch" &&
          operations.some((operation) => operation._tag !== "Sql")
        ) {
          return yield* Effect.fail(
            new ProviderMismatch({ dialect: provider.dialect, mode: "Effect" }),
          );
        }
      }
    }
  });

/** The manifest body a dialect applies for one logical migration. */
export const bodyFor = (migration: ManifestMigration, dialect: Dialect): ManifestBody | undefined =>
  migration.bodies.find((candidate) => candidate.dialect === dialect);

/**
 * Validate an existing runtime manifest against a new explicit history.
 * Existing entries must remain a prefix with identical names and checksums;
 * only append-only migrations are accepted.
 */
export const validateManifest = (
  options: ManifestValidationOptions,
): Effect.Effect<Manifest, ManifestError> =>
  Effect.gen(function* () {
    yield* verifyManifest(options.expected);
    if (options.provider !== undefined)
      yield* validateProviderBodies(options.capsules, options.provider);
    const candidate = yield* buildManifest(options);

    for (const expectedCapsule of options.expected.capsules) {
      const candidateCapsule = candidate.capsules.find(
        (capsule) => capsule.id === expectedCapsule.id,
      );
      if (candidateCapsule === undefined) {
        return yield* Effect.fail(
          new InvalidDefinition({
            subject: `capsule ${expectedCapsule.id}`,
            reason: "an applied capsule was removed from the logical history",
          }),
        );
      }
      if (candidateCapsule.namespace !== expectedCapsule.namespace) {
        return yield* Effect.fail(
          new NamespaceCollision({
            namespace: candidateCapsule.namespace,
            capsules: [expectedCapsule.id],
          }),
        );
      }
      if (candidateCapsule.migrations.length < expectedCapsule.migrations.length) {
        const expectedLast = expectedCapsule.migrations[expectedCapsule.migrations.length - 1];
        const actualLast = candidateCapsule.migrations[candidateCapsule.migrations.length - 1];
        if (expectedLast !== undefined && actualLast !== undefined) {
          return yield* Effect.fail(
            new MigrationHistoryGap({ expected: expectedLast.id, actual: actualLast.id }),
          );
        }
        return yield* Effect.fail(
          new InvalidDefinition({
            subject: `capsule ${expectedCapsule.id} history`,
            reason: "an applied migration was removed",
          }),
        );
      }

      for (let index = 0; index < expectedCapsule.migrations.length; index += 1) {
        const expected = expectedCapsule.migrations[index];
        const actual = candidateCapsule.migrations[index];
        if (expected === undefined || actual === undefined) continue;
        if (actual.id !== expected.id) {
          return yield* Effect.fail(
            new MigrationHistoryReordered({
              migrationId: actual.id,
              previousIndex: index,
              nextIndex: expectedCapsule.migrations.findIndex(
                (migration) => migration.id === actual.id,
              ),
            }),
          );
        }
        if (actual.name !== expected.name) {
          return yield* Effect.fail(
            new MigrationNameDrift({
              migrationId: actual.id,
              expected: expected.name,
              actual: actual.name,
            }),
          );
        }
        if (actual.checksum !== expected.checksum) {
          return yield* Effect.fail(
            new MigrationChecksumDrift({
              migrationId: actual.id,
              expected: expected.checksum,
              actual: actual.checksum,
            }),
          );
        }
      }
    }

    return candidate;
  });
