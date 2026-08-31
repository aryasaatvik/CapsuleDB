import { Effect, Schema } from "effect";
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
  RegistryCorrupt,
  type CapsuleError,
} from "./Error.ts";
import { resolveMigrationImplementation, type Migration, type MigrationBody } from "./Migration.ts";
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
  providerName,
  type ProviderProfile,
  type ProviderProfileError,
} from "./Provider.ts";
import { compileD1Migration, runD1Migration, type D1BatchClient } from "./internal/d1-migrator.ts";
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

/** Resolve an implementation by exact provider, then SQL dialect fallback. */
const resolveMigrationBody = (
  migration: Migration,
  provider: ProviderProfile,
): MigrationBody | undefined => resolveMigrationImplementation(migration, provider);

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

        const implementation = resolveMigrationBody(migration, provider);
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
  readonly provider: string;
}

interface MetadataRow {
  readonly id: number;
  readonly fingerprint: string;
  readonly provider: string;
}

const AppliedAt = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)),
);
const LedgerRowSchema = Schema.Struct({
  capsule_id: Schema.String,
  migration_id: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  name: Schema.String,
  checksum: Schema.String.pipe(Schema.check(Schema.isLengthBetween(64, 64))),
  applied_at: AppliedAt,
  provider: Schema.String,
});
const MetadataRowSchema = Schema.Struct({
  id: Schema.Literal(1),
  fingerprint: Schema.String.pipe(Schema.check(Schema.isLengthBetween(64, 64))),
  provider: Schema.String,
});
const CatalogCountSchema = Schema.Struct({
  count: Schema.Union([Schema.Number, Schema.String]),
});

/** The read-only plan produced before the host invokes runtime preparation. */
export interface RegistryPlan {
  readonly registry: Registry;
  readonly manifest: Manifest;
}

/** Database comparison result produced by the read-only planning operation. */
export type RegistryPlanState =
  | { readonly _tag: "Pending"; readonly fingerprint: string }
  | { readonly _tag: "Applied"; readonly fingerprint: string; readonly provider: string }
  | {
      readonly _tag: "Ahead";
      readonly capsuleId: string;
      readonly migrationId: number;
      readonly name: string;
    }
  | {
      readonly _tag: "Divergent";
      readonly expectedFingerprint: string;
      readonly actualFingerprint: string;
      readonly reason: string;
    }
  | { readonly _tag: "Corrupt"; readonly reason: string };

export interface DatabasePlan extends RegistryPlan {
  readonly state: RegistryPlanState;
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

/** Build the deterministic, database-independent manifest description. */
export const manifestPlan = (registry: Registry): Effect.Effect<RegistryPlan, ManifestError> =>
  buildManifest({ capsules: registry.capsules }).pipe(
    Effect.map((manifest) => Object.freeze({ registry, manifest })),
    Effect.withSpan("capsuledb.registry.plan"),
  );

/** Build the manifest description without touching the host database. */
export const describe = manifestPlan;

const ensureRuntimeTables = (sql: SqlClient.SqlClient): Effect.Effect<void, SqlError> =>
  Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS "${LEDGER_TABLE}" (
      capsule_id TEXT NOT NULL,
      migration_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'sqlite',
      PRIMARY KEY (capsule_id, migration_id)
    )`);
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS "${METADATA_TABLE}" (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fingerprint TEXT NOT NULL,
      provider TEXT NOT NULL
    )`);
  });

/** Inspect catalog metadata without creating or mutating CapsuleDB tables. */
const runtimeTablesExist = (
  sql: SqlClient.SqlClient,
  provider: ProviderProfile,
): Effect.Effect<"none" | "partial" | "complete", SqlError> =>
  Effect.gen(function* () {
    const rows =
      provider.dialect._tag === "Postgres"
        ? yield* sql`SELECT COUNT(*)::int AS count FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name IN (${LEDGER_TABLE}, ${METADATA_TABLE})`
        : yield* sql`SELECT COUNT(*) AS count FROM sqlite_master
            WHERE type = 'table' AND name IN (${LEDGER_TABLE}, ${METADATA_TABLE})`;
    const count = rows[0];
    if (count === undefined) return "none";
    try {
      const decoded = Schema.decodeUnknownSync(CatalogCountSchema)(count);
      const countValue = Number(decoded.count);
      return countValue === 0 ? "none" : countValue === 2 ? "complete" : "partial";
    } catch {
      return "none";
    }
  });

const readMetadata = (
  sql: SqlClient.SqlClient,
): Effect.Effect<MetadataRow | undefined, SqlError | RegistryCorrupt> =>
  Effect.gen(function* () {
    const rows = yield* sql`SELECT id, fingerprint, provider
      FROM ${sql(METADATA_TABLE)} WHERE id = 1`;
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(MetadataRowSchema))(rows).pipe(
      Effect.mapError(
        (cause) => new RegistryCorrupt({ operation: "read metadata", reason: String(cause) }),
      ),
    );
    return decoded[0];
  });

const readLedger = (
  sql: SqlClient.SqlClient,
  capsuleId: string,
  migrationId: number,
): Effect.Effect<LedgerRow | undefined, SqlError | RegistryCorrupt> =>
  Effect.gen(function* () {
    const rows = yield* sql`SELECT capsule_id, migration_id, name, checksum, applied_at, provider
      FROM ${sql(LEDGER_TABLE)}
      WHERE capsule_id = ${capsuleId} AND migration_id = ${migrationId}`;
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(LedgerRowSchema))(rows).pipe(
      Effect.mapError(
        (cause) => new RegistryCorrupt({ operation: "read ledger", reason: String(cause) }),
      ),
    );
    return decoded[0];
  });

const readLedgerRows = (
  sql: SqlClient.SqlClient,
): Effect.Effect<ReadonlyArray<LedgerRow>, SqlError | RegistryCorrupt> =>
  sql`SELECT capsule_id, migration_id, name, checksum, applied_at, provider
    FROM ${sql(LEDGER_TABLE)} ORDER BY capsule_id, migration_id`.pipe(
    Effect.flatMap((rows) =>
      Schema.decodeUnknownEffect(Schema.Array(LedgerRowSchema))(rows).pipe(
        Effect.mapError(
          (cause) => new RegistryCorrupt({ operation: "read ledger", reason: String(cause) }),
        ),
      ),
    ),
  );

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
        ledgerRow.provider !== providerName(registry.provider.provider) ||
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
): Effect.Effect<void, DatabaseAhead | LedgerConflict | ProviderMismatch> =>
  Effect.gen(function* () {
    const expectedProvider = providerName(registry.provider.provider);
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
      if (row.provider !== expectedProvider) {
        return yield* Effect.fail(
          new ProviderMismatch({ dialect: expectedProvider, mode: row.provider }),
        );
      }
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
    const body = resolveMigrationBody(migration, registry.provider);
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
      provider: providerName(registry.provider.provider),
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
      if (
        reread !== undefined &&
        reread.checksum === manifestMigration.checksum &&
        reread.name === migration.name
      ) {
        yield* Effect.logDebug("CapsuleDB migration conflict converged").pipe(
          Effect.annotateLogs("capsule_id", capsule.id),
          Effect.annotateLogs("migration_id", String(migration.id)),
          Effect.annotateLogs("outcome", "retry"),
        );
        return;
      }
      if (reread !== undefined) {
        yield* Effect.logWarning("CapsuleDB migration ledger diverged").pipe(
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
      provider: providerName(registry.provider.provider),
      body,
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ _tag: "Failure" as const, error }),
        onSuccess: () => ({ _tag: "Success" as const }),
      }),
    );

    if (outcome._tag === "Failure") {
      const reread = yield* readLedger(sql, capsule.id, migration.id);
      if (
        reread !== undefined &&
        reread.checksum === manifestMigration.checksum &&
        reread.name === migration.name
      ) {
        yield* Effect.logDebug("CapsuleDB D1 migration conflict converged").pipe(
          Effect.annotateLogs("capsule_id", capsule.id),
          Effect.annotateLogs("migration_id", String(migration.id)),
          Effect.annotateLogs("outcome", "retry"),
        );
        return;
      }
      if (reread !== undefined) {
        yield* Effect.logWarning("CapsuleDB D1 migration ledger diverged").pipe(
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

/**
 * Validate every pending D1 batch before the first migration can mutate the
 * database. Applying one batch at a time is necessary for D1's atomicity, but
 * without this pass a later oversized or unsupported migration could leave an
 * earlier migration committed before preparation failed.
 */
const preflightD1Pending = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  registryPlan: RegistryPlan,
  ledgerRows: ReadonlyArray<LedgerRow>,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    const d1 = sql as D1BatchClient;
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
        const existing = ledgerRows.find(
          (row) => row.capsule_id === capsule.id && row.migration_id === migration.id,
        );
        if (existing !== undefined) continue;

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
        const body = yield* migrationBody(registry, migration);
        yield* compileD1Migration({
          sql: d1,
          profile: registry.provider,
          capsuleId: capsule.id,
          migrationId: migration.id,
          name: migration.name,
          checksum: manifestMigration.checksum,
          provider: providerName(registry.provider.provider),
          body,
        });
      }
    }
  });

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

/** Read the current host-owned metadata without constructing or mutating tables. */
export const plan = (
  registry: Registry,
): Effect.Effect<DatabasePlan, ManifestError | SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registryPlan = yield* manifestPlan(registry);
    const sql = yield* Effect.service(SqlClient.SqlClient);
    const expectedProvider = providerName(registry.provider.provider);
    const tablesExist = yield* runtimeTablesExist(sql, registry.provider);
    if (tablesExist === "none") {
      return Object.freeze({
        ...registryPlan,
        state: { _tag: "Pending", fingerprint: registryPlan.manifest.fingerprint } as const,
      });
    }
    if (tablesExist === "partial") {
      return Object.freeze({
        ...registryPlan,
        state: { _tag: "Corrupt", reason: "registry tables are incomplete" } as const,
      });
    }

    const metadataExit = yield* readMetadata(sql).pipe(
      Effect.match({
        onFailure: (left) => ({ _tag: "Left" as const, left }),
        onSuccess: (right) => ({ _tag: "Right" as const, right }),
      }),
    );
    if (metadataExit._tag === "Left") {
      return Object.freeze({
        ...registryPlan,
        state: { _tag: "Corrupt", reason: String(metadataExit.left) } as const,
      });
    }
    const ledgerExit = yield* readLedgerRows(sql).pipe(
      Effect.match({
        onFailure: (left) => ({ _tag: "Left" as const, left }),
        onSuccess: (right) => ({ _tag: "Right" as const, right }),
      }),
    );
    if (ledgerExit._tag === "Left") {
      return Object.freeze({
        ...registryPlan,
        state: { _tag: "Corrupt", reason: String(ledgerExit.left) } as const,
      });
    }
    const metadata = metadataExit.right;
    const ledgerRows = ledgerExit.right;
    if (metadata === undefined && ledgerRows.length === 0) {
      return Object.freeze({
        ...registryPlan,
        state: { _tag: "Pending", fingerprint: registryPlan.manifest.fingerprint } as const,
      });
    }
    if (metadata === undefined) {
      return Object.freeze({
        ...registryPlan,
        state: {
          _tag: "Divergent",
          expectedFingerprint: registryPlan.manifest.fingerprint,
          actualFingerprint: "",
          reason: "registry ledger exists without readiness metadata",
        } as const,
      });
    }
    if (metadata.provider !== expectedProvider) {
      return Object.freeze({
        ...registryPlan,
        state: {
          _tag: "Divergent",
          expectedFingerprint: registryPlan.manifest.fingerprint,
          actualFingerprint: metadata.fingerprint,
          reason: `provider mismatch: expected ${expectedProvider}, found ${metadata.provider}`,
        } as const,
      });
    }
    const ledgerValidation = yield* validateExistingLedger(registry, registryPlan, ledgerRows).pipe(
      Effect.match({
        onFailure: (left) => ({ _tag: "Left" as const, left }),
        onSuccess: (right) => ({ _tag: "Right" as const, right }),
      }),
    );
    if (ledgerValidation._tag === "Left") {
      const error = ledgerValidation.left;
      if (error._tag === "DatabaseAhead") {
        return Object.freeze({
          ...registryPlan,
          state: {
            _tag: "Ahead",
            capsuleId: error.capsuleId,
            migrationId: error.migrationId,
            name: error.name,
          } as const,
        });
      }
      return Object.freeze({
        ...registryPlan,
        state: {
          _tag: "Divergent",
          expectedFingerprint: registryPlan.manifest.fingerprint,
          actualFingerprint: metadata.fingerprint,
          reason:
            error._tag === "ProviderMismatch"
              ? "provider-stamped ledger mismatch"
              : "ledger checksum or name mismatch",
        } as const,
      });
    }
    if (
      metadata.fingerprint === registryPlan.manifest.fingerprint &&
      hasCompleteLedger(registry, registryPlan, ledgerRows)
    ) {
      return Object.freeze({
        ...registryPlan,
        state: {
          _tag: "Applied",
          fingerprint: metadata.fingerprint,
          provider: metadata.provider,
        } as const,
      });
    }
    return Object.freeze({
      ...registryPlan,
      state: {
        _tag: "Divergent",
        expectedFingerprint: registryPlan.manifest.fingerprint,
        actualFingerprint: metadata.fingerprint,
        reason: "registry ledger is incomplete or fingerprint is stale",
      } as const,
    });
  });

/** Derive the lightweight readiness state from the same database plan. */
export const status = (
  registry: Registry,
): Effect.Effect<Readiness, ManifestError | SqlError, SqlClient.SqlClient> =>
  plan(registry).pipe(
    Effect.map((databasePlan) => {
      switch (databasePlan.state._tag) {
        case "Applied":
          return {
            _tag: "Ready",
            fingerprint: databasePlan.state.fingerprint,
            provider: databasePlan.state.provider,
          };
        case "Pending":
          return { _tag: "Pending", fingerprint: databasePlan.manifest.fingerprint };
        case "Ahead":
        case "Divergent":
        case "Corrupt":
          return {
            _tag: "Stale",
            expectedFingerprint: databasePlan.manifest.fingerprint,
            actualFingerprint:
              databasePlan.state._tag === "Divergent"
                ? databasePlan.state.actualFingerprint
                : "corrupt",
          };
      }
    }),
  );

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
      yield* writeMetadata(sql, registryPlan, providerName(registry.provider.provider));
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
    const registryPlan = yield* manifestPlan(registry);
    const sql = yield* Effect.service(SqlClient.SqlClient);
    if (registry.provider.dialect._tag === "Postgres") {
      yield* initializePostgres(sql);
    } else {
      yield* ensureRuntimeTables(sql);
    }

    const ledgerRows = yield* readLedgerRows(sql);
    yield* validateExistingLedger(registry, registryPlan, ledgerRows);

    const metadata = yield* readMetadata(sql);
    const expectedProvider = providerName(registry.provider.provider);
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

    // D1 can recover metadata after an interrupted metadata write, but only
    // when every provider-stamped claim exactly matches the current history.
    // Transactional providers fail closed because their outer transaction
    // should have committed metadata together with the claims.
    const firstLedgerRow = ledgerRows[0];
    if (metadata === undefined && firstLedgerRow !== undefined) {
      const providerStamped = activeLedgerRows(registry, ledgerRows).every(
        (row) => row.provider === expectedProvider,
      );
      if (
        registry.provider.capabilities._tag === "AtomicBatch" &&
        providerStamped &&
        hasCompleteLedger(registry, registryPlan, ledgerRows)
      ) {
        yield* writeMetadata(sql, registryPlan, expectedProvider);
        return makeReadinessReceipt(
          registryPlan.manifest.fingerprint,
          expectedProvider,
          registryPlan.registry.capsules.length,
        );
      }
      return yield* Effect.fail(
        new PartialMigration({
          capsuleId: firstLedgerRow.capsule_id,
          migrationId: firstLedgerRow.migration_id,
          reason: "migration ledger contains rows but readiness metadata is missing",
        }),
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

    if (registry.provider.capabilities._tag === "AtomicBatch") {
      yield* preflightD1Pending(sql, registry, registryPlan, ledgerRows);
    }

    if (registry.provider.dialect._tag === "Postgres") {
      yield* preparePostgres(sql, registry, registryPlan, options);
    } else if (registry.provider.capabilities._tag === "Transactional") {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* applyPending(sql, registry, registryPlan, options);
          yield* writeMetadata(sql, registryPlan, expectedProvider);
        }),
      );
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
    const registryPlan = yield* manifestPlan(registry);
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
      providerName(registry.provider.provider),
      registry.capsules.length,
    );
  });

// Keep the public error union discoverable from this module for callers that
// only import the composition seam.
export type { CapsuleError };
