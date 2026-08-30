import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { Capsule } from "./Capsule.ts";
import {
  DuplicateCapsule,
  DuplicateMigrationId,
  MissingProviderMigration,
  NamespaceCollision,
  ProviderMismatch,
  type CapsuleError,
  LedgerConflict,
  NotReady,
} from "./Error.ts";
import type { Migration, MigrationBody } from "./Migration.ts";
import {
  buildManifest,
  type Manifest,
  type ManifestError,
  type ManifestMigration,
} from "./Manifest.ts";
import {
  assertReady,
  makeReadinessReceipt,
  type Readiness,
  type ReadinessReceipt,
} from "./Readiness.ts";
import {
  makeProviderProfile,
  providerDialectName,
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

const LEDGER_TABLE = "capsuledb_registry_ledger";
const METADATA_TABLE = "capsuledb_registry_metadata";

interface LedgerRow {
  readonly capsule_id: string;
  readonly migration_id: number;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: string;
}

interface MetadataRow {
  readonly id: number;
  readonly fingerprint: string;
  readonly provider: string;
}

/** The read-only plan produced before the host invokes runtime preparation. */
export interface RegistryPlan {
  readonly registry: Registry;
  readonly manifest: Manifest;
}

/** SQL and definition failures emitted by lifecycle operations. */
export type RegistryRuntimeError = ManifestError | SqlError | NotReady | LedgerConflict;

/** Build the deterministic manifest plan for a validated registry. */
export const plan = (registry: Registry): Effect.Effect<RegistryPlan, ManifestError> =>
  buildManifest({ capsules: registry.capsules }).pipe(
    Effect.map((manifest) => Object.freeze({ registry, manifest })),
  );

const ensureRuntimeTables = (sql: SqlClient.SqlClient): Effect.Effect<void, SqlError> =>
  Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS "${LEDGER_TABLE}" (
      capsule_id TEXT NOT NULL,
      migration_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (capsule_id, migration_id)
    )`);
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS "${METADATA_TABLE}" (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fingerprint TEXT NOT NULL,
      provider TEXT NOT NULL
    )`);
  });

const readMetadata = (sql: SqlClient.SqlClient): Effect.Effect<MetadataRow | undefined, SqlError> =>
  Effect.gen(function* () {
    const rows = yield* sql<MetadataRow>`SELECT id, fingerprint, provider
      FROM ${sql(METADATA_TABLE)} WHERE id = 1`;
    return rows[0];
  });

const readLedger = (
  sql: SqlClient.SqlClient,
  capsuleId: string,
  migrationId: number,
): Effect.Effect<LedgerRow | undefined, SqlError> =>
  Effect.gen(function* () {
    const rows = yield* sql<LedgerRow>`SELECT capsule_id, migration_id, name, checksum, applied_at
      FROM ${sql(LEDGER_TABLE)}
      WHERE capsule_id = ${capsuleId} AND migration_id = ${migrationId}`;
    return rows[0];
  });

const readLedgerRows = (
  sql: SqlClient.SqlClient,
): Effect.Effect<ReadonlyArray<LedgerRow>, SqlError> =>
  sql<LedgerRow>`SELECT capsule_id, migration_id, name, checksum, applied_at
    FROM ${sql(LEDGER_TABLE)} ORDER BY capsule_id, migration_id`;

const expectedMigrationCount = (registry: Registry): number =>
  registry.capsules.reduce((count, capsule) => count + capsule.migrations.length, 0);

/**
 * A metadata fingerprint is only meaningful when every expected ledger row is
 * present and still agrees with the current manifest. This check deliberately
 * stays on the private ledger representation; callers only receive readiness.
 */
const hasCompleteLedger = (
  registry: Registry,
  registryPlan: RegistryPlan,
  ledgerRows: ReadonlyArray<LedgerRow>,
): boolean => {
  if (ledgerRows.length !== expectedMigrationCount(registry)) return false;

  for (const capsule of registry.capsules) {
    const manifestCapsule = registryPlan.manifest.capsules.find(
      (candidate) => candidate.id === capsule.id,
    );
    if (manifestCapsule === undefined) return false;
    for (const migration of capsule.migrations) {
      const manifestMigration = manifestCapsule.migrations.find(
        (candidate) => candidate.id === migration.id,
      );
      const ledgerRow = ledgerRows.find(
        (candidate) =>
          candidate.capsule_id === capsule.id && candidate.migration_id === migration.id,
      );
      if (
        manifestMigration === undefined ||
        ledgerRow === undefined ||
        ledgerRow.name !== migration.name ||
        ledgerRow.checksum !== manifestMigration.checksum ||
        ledgerRow.applied_at.length === 0
      ) {
        return false;
      }
    }
  }
  return true;
};

const executeStaticBody = (
  sql: SqlClient.SqlClient,
  body: MigrationBody,
): Effect.Effect<void, SqlError | ProviderMismatch> =>
  Effect.gen(function* () {
    if (body._tag !== "Sql") {
      return yield* Effect.fail(
        new ProviderMismatch({
          dialect: "Sqlite",
          mode: body._tag,
        }),
      );
    }
    for (const statement of body.statements) yield* sql.unsafe(statement);
  });

const applyMigration = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  capsule: AnyCapsule,
  migration: Migration,
  manifestMigration: ManifestMigration,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    const existing = yield* readLedger(sql, capsule.id, migration.id);
    if (existing !== undefined) {
      if (existing.checksum !== manifestMigration.checksum || existing.name !== migration.name) {
        return yield* Effect.fail(
          new LedgerConflict({
            capsuleId: capsule.id,
            migrationId: migration.id,
            expected: manifestMigration.checksum,
            actual: existing.checksum,
          }),
        );
      }
      return;
    }

    const body = migration.providers[registry.provider.dialect._tag];
    if (body === undefined) {
      return yield* Effect.fail(
        new MissingProviderMigration({
          migrationId: migration.id,
          dialect: registry.provider.dialect._tag,
        }),
      );
    }

    const outcome = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO ${sql(LEDGER_TABLE)}
            (capsule_id, migration_id, name, checksum, applied_at)
            VALUES (${capsule.id}, ${migration.id}, ${migration.name},
              ${manifestMigration.checksum}, ${new Date().toISOString()})`;
          yield* executeStaticBody(sql, body);
        }),
      )
      .pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Failure" as const, error }),
          onSuccess: () => ({ _tag: "Success" as const }),
        }),
      );

    if (outcome._tag === "Failure") {
      const reread = yield* readLedger(sql, capsule.id, migration.id);
      if (reread !== undefined && reread.checksum === manifestMigration.checksum) return;
      if (reread !== undefined) {
        return yield* Effect.fail(
          new LedgerConflict({
            capsuleId: capsule.id,
            migrationId: migration.id,
            expected: manifestMigration.checksum,
            actual: reread.checksum,
          }),
        );
      }
      return yield* Effect.fail(outcome.error);
    }
  });

/** Read the current host-owned metadata without constructing a service layer. */
export const status = (
  registry: Registry,
): Effect.Effect<Readiness, ManifestError | SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registryPlan = yield* plan(registry);
    const sql = yield* Effect.service(SqlClient.SqlClient);
    yield* ensureRuntimeTables(sql);
    const metadata = yield* readMetadata(sql);
    if (metadata === undefined) {
      const pending: Readiness = {
        _tag: "Pending",
        fingerprint: registryPlan.manifest.fingerprint,
      };
      return pending;
    }
    const ledgerRows = yield* readLedgerRows(sql);
    const expectedProvider = providerDialectName(registry.provider.dialect);
    if (
      metadata.fingerprint === registryPlan.manifest.fingerprint &&
      metadata.provider === expectedProvider &&
      hasCompleteLedger(registry, registryPlan, ledgerRows)
    ) {
      const ready: Readiness = {
        _tag: "Ready",
        fingerprint: metadata.fingerprint,
        provider: metadata.provider,
      };
      return ready;
    }
    const stale: Readiness = {
      _tag: "Stale",
      expectedFingerprint: registryPlan.manifest.fingerprint,
      actualFingerprint: metadata.fingerprint,
    };
    return stale;
  });

/**
 * Apply all pending static migrations using the host's existing SqlClient.
 * The ledger claim and each migration body share one transaction, while an
 * exact concurrent loser rereads the committed claim before returning.
 */
export const prepare = (
  registry: Registry,
): Effect.Effect<ReadinessReceipt, RegistryRuntimeError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registryPlan = yield* plan(registry);
    const sql = yield* Effect.service(SqlClient.SqlClient);
    yield* ensureRuntimeTables(sql);

    const ledgerRows = yield* readLedgerRows(sql);
    for (const row of ledgerRows) {
      const capsule = registry.capsules.find((candidate) => candidate.id === row.capsule_id);
      const manifestCapsule = registryPlan.manifest.capsules.find(
        (candidate) => candidate.id === row.capsule_id,
      );
      const migration = capsule?.migrations.find((candidate) => candidate.id === row.migration_id);
      const manifestMigration = manifestCapsule?.migrations.find(
        (candidate) => candidate.id === row.migration_id,
      );
      if (capsule === undefined || migration === undefined || manifestMigration === undefined) {
        return yield* Effect.fail(
          new NotReady({
            expectedFingerprint: registryPlan.manifest.fingerprint,
            actualFingerprint: "unexpected-ledger-entry",
          }),
        );
      }
      if (row.checksum !== manifestMigration.checksum || row.name !== migration.name) {
        return yield* Effect.fail(
          new LedgerConflict({
            capsuleId: row.capsule_id,
            migrationId: row.migration_id,
            expected: manifestMigration.checksum,
            actual: row.checksum,
          }),
        );
      }
    }

    const metadata = yield* readMetadata(sql);
    const expectedProvider = providerDialectName(registry.provider.dialect);
    if (
      metadata?.fingerprint === registryPlan.manifest.fingerprint &&
      metadata.provider === expectedProvider &&
      hasCompleteLedger(registry, registryPlan, ledgerRows)
    ) {
      return makeReadinessReceipt(
        metadata.fingerprint,
        expectedProvider,
        registryPlan.registry.capsules.length,
      );
    }

    for (const capsule of registry.capsules) {
      const manifestCapsule = registryPlan.manifest.capsules.find(
        (candidate) => candidate.id === capsule.id,
      );
      if (manifestCapsule === undefined) {
        return yield* Effect.fail(
          new NotReady({
            expectedFingerprint: registryPlan.manifest.fingerprint,
            actualFingerprint: "missing-capsule",
          }),
        );
      }
      for (const migration of capsule.migrations) {
        const manifestMigration = manifestCapsule.migrations.find(
          (candidate) => candidate.id === migration.id,
        );
        if (manifestMigration === undefined) {
          return yield* Effect.fail(
            new NotReady({
              expectedFingerprint: registryPlan.manifest.fingerprint,
              actualFingerprint: "missing-migration",
            }),
          );
        }
        yield* applyMigration(sql, registry, capsule, migration, manifestMigration);
      }
    }

    yield* sql`INSERT INTO ${sql(METADATA_TABLE)} (id, fingerprint, provider)
      VALUES (1, ${registryPlan.manifest.fingerprint}, ${providerDialectName(registry.provider.dialect)})
      ON CONFLICT(id) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        provider = excluded.provider`;

    return makeReadinessReceipt(
      registryPlan.manifest.fingerprint,
      providerDialectName(registry.provider.dialect),
      registryPlan.registry.capsules.length,
    );
  });

/** Assert the registry is already prepared without applying migrations. */
export const assertRegistryReady = (
  registry: Registry,
): Effect.Effect<ReadinessReceipt, ManifestError | SqlError | NotReady, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registryPlan = yield* plan(registry);
    const current = yield* status(registry);
    if (current._tag !== "Ready") {
      const actual =
        current._tag === "Pending"
          ? ""
          : current.actualFingerprint !== registryPlan.manifest.fingerprint
            ? current.actualFingerprint
            : "provider-mismatch";
      yield* assertReady(registryPlan.manifest.fingerprint, actual);
    }
    return makeReadinessReceipt(
      registryPlan.manifest.fingerprint,
      providerDialectName(registry.provider.dialect),
      registry.capsules.length,
    );
  });

// Keep the public error union discoverable from this module for callers that
// only import the composition seam.
export type { CapsuleError };
