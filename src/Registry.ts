import { Effect } from "effect";

import type { Capsule } from "./Capsule.ts";
import {
  DuplicateCapsule,
  DuplicateMigrationId,
  MissingProviderMigration,
  NamespaceCollision,
  ProviderMismatch,
  type CapsuleError,
} from "./Error.ts";
import type { Migration } from "./Migration.ts";
import {
  makeProviderProfile,
  type ProviderProfile,
  type ProviderProfileError,
} from "./Provider.ts";

/** Existential capsule view retained by a heterogeneous registry. */
export type AnyCapsule = Capsule<never, unknown, unknown>;

/** Input to explicit registry composition. */
export interface RegistryOptions {
  readonly provider: ProviderProfile;
  readonly capsules: ReadonlyArray<AnyCapsule>;
}

/** A validated, immutable set of capsules for one provider profile. */
export interface Registry {
  readonly provider: ProviderProfile;
  readonly capsules: ReadonlyArray<AnyCapsule>;
}

export type RegistryError =
  | ProviderProfileError
  | DuplicateCapsule
  | NamespaceCollision
  | DuplicateMigrationId
  | MissingProviderMigration
  | ProviderMismatch;

/**
 * Validate explicit capsule composition before any provider state is touched.
 * IDs and namespaces are checked independently so collisions cannot be hidden
 * behind a host rename or a provider-specific table prefix.
 */
export const makeRegistry = (options: RegistryOptions): Effect.Effect<Registry, RegistryError> =>
  Effect.gen(function* () {
    const provider = yield* makeProviderProfile(options.provider);

    for (let index = 0; index < options.capsules.length; index += 1) {
      const capsule = options.capsules[index];
      if (capsule === undefined) continue;

      const duplicateId = options.capsules.find(
        (candidate, candidateIndex) => candidateIndex < index && candidate.id === capsule.id,
      );
      if (duplicateId !== undefined) {
        return yield* Effect.fail(new DuplicateCapsule({ capsuleId: capsule.id }));
      }
    }

    for (let index = 0; index < options.capsules.length; index += 1) {
      const capsule = options.capsules[index];
      if (capsule === undefined) continue;

      const namespacePeers = options.capsules.filter(
        (candidate, candidateIndex) =>
          candidateIndex !== index && candidate.namespace === capsule.namespace,
      );
      if (namespacePeers.length > 0) {
        return yield* Effect.fail(
          new NamespaceCollision({
            namespace: capsule.namespace,
            capsules: [capsule.id, ...namespacePeers.map((peer) => peer.id)],
          }),
        );
      }
    }

    for (const capsule of options.capsules) {
      const seenMigrationIds: Array<number> = [];
      for (const migration of capsule.migrations) {
        if (seenMigrationIds.includes(migration.id)) {
          return yield* Effect.fail(new DuplicateMigrationId({ migrationId: migration.id }));
        }
        seenMigrationIds.push(migration.id);

        const implementation = migration.providers[provider.dialect._tag];
        if (implementation === undefined) {
          return yield* Effect.fail(
            new MissingProviderMigration({
              migrationId: migration.id,
              dialect: provider.dialect._tag,
            }),
          );
        }
        if (provider.capabilities._tag === "AtomicBatch" && implementation._tag !== "Sql") {
          return yield* Effect.fail(
            new ProviderMismatch({
              dialect: provider.dialect._tag,
              mode: implementation._tag,
            }),
          );
        }
      }
    }

    return Object.freeze({
      provider,
      capsules: Object.freeze([...options.capsules]),
    });
  });

/** Return a capsule's logical migrations without exposing persistence rows. */
export const migrationsOf = (capsule: Capsule<never, unknown, unknown>): ReadonlyArray<Migration> =>
  capsule.migrations;

// Keep the public error union discoverable from this module for callers that
// only import the composition seam.
export type { CapsuleError };
