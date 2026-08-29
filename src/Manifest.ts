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
  type CapsuleError,
} from "./Error.ts";
import type { Migration, MigrationBody, MigrationImplementations } from "./Migration.ts";
import { providerDialectTags, type ProviderProfile } from "./Provider.ts";
import { sha256 } from "./internal/checksum.ts";

/** A lowercase SHA-256 checksum of canonical authored migration metadata. */
export const Checksum = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(64, 64), Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Checksum"),
);

export type Checksum = typeof Checksum.Type;

const ManifestDialect = Schema.Union([
  Schema.Literal("Sqlite"),
  Schema.Literal("Postgres"),
  Schema.Literal("D1"),
]);

/** Runtime-readable provider body metadata; Effect functions are omitted. */
export const ManifestProvider = Schema.TaggedUnion({
  Sql: {
    dialect: ManifestDialect,
    source: Schema.String,
    statements: Schema.Array(Schema.String),
  },
  Effect: {
    dialect: ManifestDialect,
    source: Schema.String,
  },
});

export type ManifestProvider = typeof ManifestProvider.Type;

/** One logical migration's checksum and provider source metadata. */
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
  providers: Schema.Array(ManifestProvider),
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
  | CapsuleError
  | InvalidDefinition
  | DuplicateCapsule
  | NamespaceCollision
  | DuplicateMigrationId
  | MigrationHistoryGap
  | MigrationHistoryReordered
  | MigrationNameDrift
  | MigrationChecksumDrift
  | MissingProviderMigration
  | ProviderMismatch;

const sortedProviderTags = (): ReadonlyArray<(typeof providerDialectTags)[number]> =>
  [...providerDialectTags].sort();

const manifestBody = (
  dialect: (typeof providerDialectTags)[number],
  body: MigrationBody,
): ManifestProvider =>
  body._tag === "Sql"
    ? {
        _tag: "Sql",
        dialect,
        source: body.source,
        statements: [...body.statements],
      }
    : {
        _tag: "Effect",
        dialect,
        source: body.source,
      };

const manifestBodies = (providers: MigrationImplementations): ReadonlyArray<ManifestProvider> => {
  const result: Array<ManifestProvider> = [];
  for (const dialect of sortedProviderTags()) {
    const body = providers[dialect];
    if (body !== undefined) result.push(manifestBody(dialect, body));
  }
  return result;
};

const canonicalBody = (body: ManifestProvider): Readonly<Record<string, unknown>> =>
  body._tag === "Sql"
    ? {
        mode: body._tag,
        dialect: body.dialect,
        source: body.source,
        statements: body.statements,
      }
    : {
        mode: body._tag,
        dialect: body.dialect,
        source: body.source,
      };

const canonicalMigration = (
  capsuleId: string,
  migration: Migration,
  providers: ReadonlyArray<ManifestProvider>,
) =>
  JSON.stringify({
    capsuleId,
    migrationId: migration.id,
    name: migration.name,
    risk: migration.risk,
    providers: providers.map(canonicalBody),
  });

const canonicalManifestMigration = (capsuleId: string, migration: ManifestMigration): string =>
  JSON.stringify({
    capsuleId,
    migrationId: migration.id,
    name: migration.name,
    risk: migration.risk,
    providers: migration.providers.map(canonicalBody),
  });

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
        providers: migration.providers.map((provider) =>
          provider._tag === "Sql"
            ? {
                mode: provider._tag,
                dialect: provider.dialect,
                source: provider.source,
                statements: provider.statements,
              }
            : {
                mode: provider._tag,
                dialect: provider.dialect,
                source: provider.source,
              },
        ),
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
      const providers = manifestBodies(migration.providers);
      if (providers.length === 0) {
        return yield* Effect.fail(
          new InvalidDefinition({
            subject: `migration ${migration.id}`,
            reason: "at least one provider source is required",
          }),
        );
      }
      for (const body of providers) {
        if (body.source.length === 0) {
          return yield* Effect.fail(
            new InvalidDefinition({
              subject: `migration ${migration.id} source`,
              reason: "source text must not be empty",
            }),
          );
        }
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

/** Build a deterministic manifest from explicit in-memory migration sources. */
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
        const providers = manifestBodies(migration.providers);
        const checksum = yield* sha256(canonicalMigration(capsule.id, migration, providers));
        migrations.push(
          yield* decodeManifestMigration({
            id: migration.id,
            name: migration.name,
            risk: migration.risk,
            checksum,
            providers,
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

        if (migration.providers.length === 0) {
          return yield* Effect.fail(
            new InvalidDefinition({
              subject: `manifest migration ${migration.id}`,
              reason: "at least one provider source is required",
            }),
          );
        }
        for (
          let providerIndex = 0;
          providerIndex < migration.providers.length;
          providerIndex += 1
        ) {
          const provider = migration.providers[providerIndex];
          if (provider === undefined) continue;
          if (
            migration.providers.findIndex((candidate) => candidate.dialect === provider.dialect) !==
            providerIndex
          ) {
            return yield* Effect.fail(
              new InvalidDefinition({
                subject: `manifest migration ${migration.id} providers`,
                reason: `duplicate provider ${provider.dialect}`,
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
        const body = migration.providers[provider.dialect._tag];
        if (body === undefined) {
          return yield* Effect.fail(
            new MissingProviderMigration({
              migrationId: migration.id,
              dialect: provider.dialect._tag,
            }),
          );
        }
        if (provider.capabilities._tag === "AtomicBatch" && body._tag !== "Sql") {
          return yield* Effect.fail(
            new ProviderMismatch({
              dialect: provider.dialect._tag,
              mode: body._tag,
            }),
          );
        }
      }
    }
  });

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
