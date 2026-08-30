import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { Capsule } from "./Capsule.ts";
import {
  DatabaseAhead,
  DestructiveMigrationUnauthorized,
  DuplicateCapsule,
  DuplicateMigrationId,
  InvalidDefinition,
  LedgerConflict,
  MissingProviderMigration,
  NamespaceCollision,
  NotReady,
  PartialMigration,
  PreparationFailed,
  ProviderMismatch,
  type CapsuleError,
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
import { runD1Migration, type D1BatchClient } from "./internal/d1-migrator.ts";
import {
  LEDGER_TABLE,
  METADATA_TABLE,
  runTransactionalMigration,
} from "./internal/transactional-migrator.ts";

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

/** Explicit authorization for destructive migration bodies for one run. */
export interface PrepareOptions {
  /** Permit migrations marked `destructive`; defaults to `false`. */
  readonly allowDestructive?: boolean;
}

/** SQL and definition failures emitted by lifecycle operations. */
export type RegistryRuntimeError =
  | ManifestError
  | SqlError
  | NotReady
  | LedgerConflict
  | DatabaseAhead
  | DestructiveMigrationUnauthorized
  | PartialMigration
  | PreparationFailed
  | ProviderMismatch
  | InvalidDefinition;

/** Build the deterministic manifest plan for a validated registry. */
export const plan = (registry: Registry): Effect.Effect<RegistryPlan, ManifestError> =>
  buildManifest({ capsules: registry.capsules }).pipe(
    Effect.map((manifest) => Object.freeze({ registry, manifest })),
    Effect.withSpan("capsuledb.registry.plan"),
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

const activeLedgerRows = (
  registry: Registry,
  ledgerRows: ReadonlyArray<LedgerRow>,
): ReadonlyArray<LedgerRow> =>
  ledgerRows.filter((row) => registry.capsules.some((capsule) => capsule.id === row.capsule_id));

/**
 * A metadata fingerprint is only meaningful when every expected active ledger
 * row is present and still agrees with the current manifest. Rows for capsules
 * removed from the registry are deliberately ignored and preserved.
 */
const hasCompleteLedger = (
  registry: Registry,
  registryPlan: RegistryPlan,
  ledgerRows: ReadonlyArray<LedgerRow>,
): boolean => {
  const activeRows = activeLedgerRows(registry, ledgerRows);
  if (activeRows.length !== expectedMigrationCount(registry)) return false;

  for (const capsule of registry.capsules) {
    const manifestCapsule = registryPlan.manifest.capsules.find(
      (candidate) => candidate.id === capsule.id,
    );
    if (manifestCapsule === undefined) return false;
    for (const migration of capsule.migrations) {
      const manifestMigration = manifestCapsule.migrations.find(
        (candidate) => candidate.id === migration.id,
      );
      const ledgerRow = activeRows.find(
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

/** Validate all known ledger rows before any new migration can mutate state. */
const validateExistingLedger = (
  registry: Registry,
  registryPlan: RegistryPlan,
  ledgerRows: ReadonlyArray<LedgerRow>,
): Effect.Effect<void, DatabaseAhead | LedgerConflict> =>
  Effect.gen(function* () {
    for (const row of ledgerRows) {
      const capsule = registry.capsules.find((candidate) => candidate.id === row.capsule_id);
      // A removed capsule retains its ledger rows and physical objects. It is
      // intentionally outside the active registry until it is re-registered.
      if (capsule === undefined) continue;

      const manifestCapsule = registryPlan.manifest.capsules.find(
        (candidate) => candidate.id === row.capsule_id,
      );
      const migration = capsule.migrations.find((candidate) => candidate.id === row.migration_id);
      const manifestMigration = manifestCapsule?.migrations.find(
        (candidate) => candidate.id === row.migration_id,
      );
      if (migration === undefined || manifestMigration === undefined) {
        return yield* Effect.fail(
          new DatabaseAhead({
            capsuleId: row.capsule_id,
            migrationId: row.migration_id,
            name: row.name,
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
  });

const writeMetadata = (
  sql: SqlClient.SqlClient,
  registryPlan: RegistryPlan,
  provider: string,
): Effect.Effect<void, SqlError> =>
  sql`INSERT INTO ${sql(METADATA_TABLE)} (id, fingerprint, provider)
    VALUES (1, ${registryPlan.manifest.fingerprint}, ${provider})
    ON CONFLICT(id) DO UPDATE SET
      fingerprint = excluded.fingerprint,
      provider = excluded.provider`;

const migrationBody = (
  registry: Registry,
  migration: Migration,
): Effect.Effect<MigrationBody, MissingProviderMigration> =>
  Effect.gen(function* () {
    const body = migration.providers[registry.provider.dialect._tag];
    if (body === undefined) {
      return yield* Effect.fail(
        new MissingProviderMigration({
          migrationId: migration.id,
          dialect: registry.provider.dialect._tag,
        }),
      );
    }
    return body;
  });

const unauthorizedDestructive = (
  capsule: AnyCapsule,
  migration: Migration,
  options: PrepareOptions,
): Effect.Effect<void, DestructiveMigrationUnauthorized> =>
  migration.risk === "destructive" && options.allowDestructive !== true
    ? Effect.fail(
        new DestructiveMigrationUnauthorized({
          capsuleId: capsule.id,
          migrationId: migration.id,
          name: migration.name,
        }),
      )
    : Effect.void;

const applyTransactional = (
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

    const body = yield* migrationBody(registry, migration);
    const outcome = yield* runTransactionalMigration({
      sql,
      capsuleId: capsule.id,
      migrationId: migration.id,
      name: migration.name,
      checksum: manifestMigration.checksum,
      body,
    }).pipe(
      Effect.tap(() =>
        Effect.logDebug("CapsuleDB migration applied").pipe(
          Effect.annotateLogs("capsule_id", capsule.id),
          Effect.annotateLogs("migration_id", String(migration.id)),
          Effect.annotateLogs("outcome", "apply"),
        ),
      ),
      Effect.match({
        onFailure: (error) => ({ _tag: "Failure" as const, error }),
        onSuccess: () => ({ _tag: "Success" as const }),
      }),
    );

    if (outcome._tag === "Failure") {
      const reread = yield* readLedger(sql, capsule.id, migration.id);
      if (reread !== undefined && reread.checksum === manifestMigration.checksum) {
        yield* Effect.logDebug("CapsuleDB migration conflict converged").pipe(
          Effect.annotateLogs("capsule_id", capsule.id),
          Effect.annotateLogs("migration_id", String(migration.id)),
          Effect.annotateLogs("outcome", "retry"),
        );
        return;
      }
      if (reread !== undefined) {
        yield* Effect.logWarning("CapsuleDB migration checksum diverged").pipe(
          Effect.annotateLogs("capsule_id", capsule.id),
          Effect.annotateLogs("migration_id", String(migration.id)),
          Effect.annotateLogs("outcome", "divergence"),
        );
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
  }).pipe(Effect.withSpan("capsuledb.registry.apply"));

const applyD1 = (
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

    const body = yield* migrationBody(registry, migration);
    const d1 = sql as D1BatchClient;
    const outcome = yield* runD1Migration({
      sql: d1,
      profile: registry.provider,
      capsuleId: capsule.id,
      migrationId: migration.id,
      name: migration.name,
      checksum: manifestMigration.checksum,
      body,
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ _tag: "Failure" as const, error }),
        onSuccess: () => ({ _tag: "Success" as const }),
      }),
    );

    if (outcome._tag === "Failure") {
      const reread = yield* readLedger(sql, capsule.id, migration.id);
      if (reread !== undefined && reread.checksum === manifestMigration.checksum) {
        yield* Effect.logDebug("CapsuleDB D1 migration conflict converged").pipe(
          Effect.annotateLogs("capsule_id", capsule.id),
          Effect.annotateLogs("migration_id", String(migration.id)),
          Effect.annotateLogs("outcome", "retry"),
        );
        return;
      }
      if (reread !== undefined) {
        yield* Effect.logWarning("CapsuleDB D1 migration checksum diverged").pipe(
          Effect.annotateLogs("capsule_id", capsule.id),
          Effect.annotateLogs("migration_id", String(migration.id)),
          Effect.annotateLogs("outcome", "divergence"),
        );
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

    yield* Effect.logDebug("CapsuleDB D1 migration applied").pipe(
      Effect.annotateLogs("capsule_id", capsule.id),
      Effect.annotateLogs("migration_id", String(migration.id)),
      Effect.annotateLogs("outcome", "apply"),
    );
  }).pipe(Effect.withSpan("capsuledb.registry.apply.d1"));

const applyPending = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  registryPlan: RegistryPlan,
  options: PrepareOptions,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
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
        const existing = yield* readLedger(sql, capsule.id, migration.id);
        if (existing !== undefined) {
          if (
            existing.checksum !== manifestMigration.checksum ||
            existing.name !== migration.name
          ) {
            return yield* Effect.fail(
              new LedgerConflict({
                capsuleId: capsule.id,
                migrationId: migration.id,
                expected: manifestMigration.checksum,
                actual: existing.checksum,
              }),
            );
          }
          continue;
        }
        if (registry.provider.capabilities._tag === "AtomicBatch") {
          yield* applyD1(sql, registry, capsule, migration, manifestMigration);
        } else {
          yield* applyTransactional(sql, registry, capsule, migration, manifestMigration);
        }
      }
    }
  });

const firstIncompleteMigration = (
  registry: Registry,
  ledgerRows: ReadonlyArray<LedgerRow>,
): readonly [AnyCapsule, Migration] | undefined => {
  for (const capsule of registry.capsules) {
    for (const migration of capsule.migrations) {
      const row = ledgerRows.find(
        (candidate) =>
          candidate.capsule_id === capsule.id && candidate.migration_id === migration.id,
      );
      if (row === undefined) return [capsule, migration];
    }
  }
  return undefined;
};

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

const preparePostgres = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  registryPlan: RegistryPlan,
  options: PrepareOptions,
): Effect.Effect<void, RegistryRuntimeError> =>
  sql.withTransaction(
    Effect.gen(function* () {
      // PostgreSQL advisory locks are database-wide and transaction-scoped.
      // The stable key serializes every CapsuleDB registry on this database.
      yield* sql`SELECT pg_advisory_xact_lock(${45_120_617})`;
      const ledgerRows = yield* readLedgerRows(sql);
      yield* validateExistingLedger(registry, registryPlan, ledgerRows);
      yield* applyPending(sql, registry, registryPlan, options);
      yield* writeMetadata(sql, registryPlan, providerDialectName(registry.provider.dialect));
    }),
  );

const initializePostgres = (sql: SqlClient.SqlClient): Effect.Effect<void, SqlError> =>
  sql.withTransaction(
    Effect.gen(function* () {
      // The advisory lock must cover first-use DDL as well as migration DDL;
      // PostgreSQL can still race two CREATE TABLE IF NOT EXISTS statements
      // while registering the table's row type.
      yield* sql`SELECT pg_advisory_xact_lock(${45_120_617})`;
      yield* ensureRuntimeTables(sql);
    }),
  );

/**
 * Apply all pending migrations using the host's existing SQL client.
 *
 * Transactional providers use their driver's transaction/savepoint behavior;
 * PostgreSQL additionally serializes preparation with a database-wide
 * transaction-scoped advisory lock. D1 uses only its atomic claim-first batch.
 */
export const prepare = (
  registry: Registry,
  options: PrepareOptions = {},
): Effect.Effect<ReadinessReceipt, RegistryRuntimeError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registryPlan = yield* plan(registry);
    const sql = yield* Effect.service(SqlClient.SqlClient);
    if (registry.provider.dialect._tag === "Postgres") {
      yield* initializePostgres(sql);
    } else {
      yield* ensureRuntimeTables(sql);
    }

    const ledgerRows = yield* readLedgerRows(sql);
    yield* validateExistingLedger(registry, registryPlan, ledgerRows);

    const metadata = yield* readMetadata(sql);
    const expectedProvider = providerDialectName(registry.provider.dialect);
    if (metadata !== undefined && metadata.provider !== expectedProvider) {
      yield* Effect.logWarning("CapsuleDB provider diverged").pipe(
        Effect.annotateLogs("expected_provider", expectedProvider),
        Effect.annotateLogs("actual_provider", metadata.provider),
        Effect.annotateLogs("outcome", "divergence"),
      );
      return yield* Effect.fail(
        new ProviderMismatch({ dialect: expectedProvider, mode: metadata.provider }),
      );
    }

    const complete = hasCompleteLedger(registry, registryPlan, ledgerRows);
    if (metadata?.fingerprint === registryPlan.manifest.fingerprint && !complete) {
      const incomplete = firstIncompleteMigration(registry, ledgerRows);
      if (incomplete !== undefined) {
        return yield* Effect.fail(
          new PartialMigration({
            capsuleId: incomplete[0].id,
            migrationId: incomplete[1].id,
            reason:
              "readiness metadata claims the registry is complete but its ledger is incomplete",
          }),
        );
      }
    }

    if (metadata?.fingerprint === registryPlan.manifest.fingerprint && complete) {
      yield* Effect.logDebug("CapsuleDB registry ready").pipe(
        Effect.annotateLogs("provider", expectedProvider),
        Effect.annotateLogs("outcome", "ready"),
      );
      return makeReadinessReceipt(
        registryPlan.manifest.fingerprint,
        expectedProvider,
        registryPlan.registry.capsules.length,
      );
    }

    // Refuse every pending destructive operation before applying any earlier
    // additive migration in this run.
    for (const capsule of registry.capsules) {
      for (const migration of capsule.migrations) {
        const existing = ledgerRows.find(
          (row) => row.capsule_id === capsule.id && row.migration_id === migration.id,
        );
        if (existing === undefined) {
          yield* unauthorizedDestructive(capsule, migration, options);
        }
      }
    }

    if (registry.provider.dialect._tag === "Postgres") {
      yield* preparePostgres(sql, registry, registryPlan, options);
    } else {
      yield* applyPending(sql, registry, registryPlan, options);
      yield* writeMetadata(sql, registryPlan, expectedProvider);
    }

    yield* Effect.logDebug("CapsuleDB registry ready").pipe(
      Effect.annotateLogs("provider", expectedProvider),
      Effect.annotateLogs("outcome", "ready"),
    );
    return makeReadinessReceipt(
      registryPlan.manifest.fingerprint,
      expectedProvider,
      registryPlan.registry.capsules.length,
    );
  }).pipe(Effect.withSpan("capsuledb.registry.prepare"));

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
