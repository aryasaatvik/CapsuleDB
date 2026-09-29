import { Effect, Layer, Schema } from "effect";
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
  LegacyLedgerUpgradeUnauthorized,
  MissingProviderMigration,
  NotReady,
  PartialMigration,
  PreparationFailed,
  ProviderMismatch,
  RegistryCorrupt,
} from "./Error.ts";
import { resolve as resolveMigration, type Migration, type Operation } from "./Migration.ts";
import {
  bodyFor,
  buildManifest,
  decodeManifest,
  type Manifest,
  type ManifestBody,
  type ManifestError,
} from "./Manifest.ts";
import type { PendingMigration, Readiness, Ready } from "./Readiness.ts";
import {
  makeProviderProfile,
  providerName,
  type ProviderProfile,
  type ProviderProfileError,
} from "./Provider.ts";
import { compileD1Migration, runD1Migration, type D1BatchClient } from "./internal/d1-migrator.ts";
import * as GatedClient from "./internal/gated-client.ts";
import { ledgerTables, runTransactionalMigration } from "./internal/transactional-migrator.ts";

/** Existential capsule view retained by a heterogeneous registry. */
type AnyCapsule = Capsule<never, unknown, unknown>;

/** What every preparation needs besides the migration history itself. */
export interface Preparation {
  readonly provider: ProviderProfile;
  /** Permit migrations marked `destructive`; defaults to `false`. */
  readonly allowDestructive?: boolean;
  /**
   * Permit re-keying a ledger written before per-dialect checksums; defaults to
   * `false`.
   *
   * A manifest v1 checksum covered every dialect body at once under a
   * canonicalization this version cannot reproduce, so the upgrade can only
   * trust a row's logical identity — capsule, migration id, and name — and not
   * its content. Confirm the applied history is unchanged, then opt in.
   */
  readonly allowLegacyLedgerUpgrade?: boolean;
  /**
   * Prefix for the two tables CapsuleDB's own lifecycle owns; defaults to
   * `capsuledb`. It is part of the physical layout, so two registries can share
   * a database, but a deployed registry must never change it.
   */
  readonly prefix?: string;
}

/** Explicit registry composition for one provider profile. */
export interface Options<
  Caps extends ReadonlyArray<AnyCapsule> = ReadonlyArray<AnyCapsule>,
> extends Preparation {
  readonly capsules: Caps;
  /**
   * `prepare` (default) applies pending migrations. `assert` applies nothing
   * and fails unless the database is already Ready, which is what a host that
   * prepared at deploy time or applied `capsuledb emit` output wants.
   */
  readonly mode?: "prepare" | "assert";
  /**
   * When `Registry.layer` runs the `mode` check: `boot` (default) while the
   * Layer is built, or `first-use` on the first connection a capsule takes.
   * Ignored by `prepare`, `assert`, and `status`, which always run now.
   */
  readonly readiness?: "boot" | "first-use";
}

/**
 * A registry described by a published manifest instead of live capsules.
 *
 * This is the input a deploy tool holds: plain data it can serialize and diff.
 * The manifest is verified — structure, every body checksum, and the
 * fingerprint — before the database is touched, and its SQL bodies for the
 * provider's dialect are what preparation applies. A database prepared from a
 * manifest reads Ready to the capsules that produced it, and the reverse.
 */
export interface ManifestOptions extends Preparation {
  readonly manifest: typeof Manifest.Encoded;
}

/**
 * The merged service set every capsule in a registry provides.
 *
 * The extraction is per element rather than over the whole array: a capsule's
 * service sits in `Layer`'s contravariant output position, so inferring across
 * all elements at once would intersect the services instead of uniting them.
 */
export type Services<Caps extends ReadonlyArray<AnyCapsule>> = {
  [Index in keyof Caps]: Caps[Index] extends Capsule<infer Service, unknown, unknown>
    ? Service
    : never;
}[number];

/** The merged failure set every capsule's layer can raise while building. */
export type Failures<Caps extends ReadonlyArray<AnyCapsule>> = {
  [Index in keyof Caps]: Caps[Index] extends Capsule<never, infer Failure, unknown>
    ? Failure
    : never;
}[number];

/** The merged service set every capsule's layer still needs from the host. */
export type Requirements<Caps extends ReadonlyArray<AnyCapsule>> = {
  [Index in keyof Caps]: Caps[Index] extends Capsule<never, unknown, infer Required>
    ? Required
    : never;
}[number];

/**
 * Composition failures raised before any host database state is touched.
 *
 * These stay individually tagged instead of collapsing into one opaque error:
 * a host recovering from `DuplicateCapsule` and a host recovering from
 * `MissingProviderMigration` take different actions.
 */
export type RegistryError =
  | InvalidDefinition
  | ProviderProfileError
  | ManifestError
  | DuplicateCapsule
  | DuplicateMigrationId
  | MissingProviderMigration
  | ProviderMismatch;

/** SQL and lifecycle failures emitted by preparation and readiness reads. */
export type RegistryRuntimeError =
  | RegistryError
  | SqlError
  | RegistryCorrupt
  | NotReady
  | LedgerConflict
  | DatabaseAhead
  | DestructiveMigrationUnauthorized
  | LegacyLedgerUpgradeUnauthorized
  | PartialMigration
  | PreparationFailed;

/** One migration as this registry's dialect applies it. */
interface PlannedMigration {
  readonly id: number;
  readonly name: string;
  readonly risk: Migration["risk"];
  readonly operations: ReadonlyArray<Operation>;
}

/** A capsule's history, resolved for one dialect. */
interface PlannedCapsule {
  readonly id: string;
  readonly migrations: ReadonlyArray<PlannedMigration>;
}

/** A validated migration history and the manifest it describes. */
interface Registry {
  readonly provider: ProviderProfile;
  readonly capsules: ReadonlyArray<PlannedCapsule>;
  readonly allowDestructive: boolean;
  readonly allowLegacyLedgerUpgrade: boolean;
  readonly ledger: string;
  readonly metadata: string;
  readonly manifest: Manifest;
}

const tablesOf = (prefix: string | undefined) =>
  Effect.try({
    try: () => ledgerTables(prefix),
    catch: (cause) =>
      cause instanceof InvalidDefinition
        ? cause
        : new InvalidDefinition({ subject: "registry prefix", reason: String(cause) }),
  });

/**
 * Validate explicit capsule composition before any provider state is touched.
 *
 * Physical namespace collisions are not checked here: the namespace derivation
 * is injective over validated capsule identifiers, so a collision implies a
 * duplicate identifier, and `buildManifest` still verifies both invariants once
 * for the fingerprint it produces.
 */
const resolveCapsules = (options: Options): Effect.Effect<Registry, RegistryError> =>
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

    const capsules: Array<PlannedCapsule> = [];
    for (const capsule of options.capsules) {
      const migrations: Array<PlannedMigration> = [];
      for (const migration of capsule.migrations) {
        if (migrations.some((planned) => planned.id === migration.id)) {
          return yield* Effect.fail(new DuplicateMigrationId({ migrationId: migration.id }));
        }

        const operations = resolveMigration(migration, provider.dialect);
        if (operations === undefined) {
          return yield* Effect.fail(
            new MissingProviderMigration({
              migrationId: migration.id,
              dialect: provider.dialect,
            }),
          );
        }
        const dynamic = operations.find((operation) => operation._tag !== "Sql");
        if (provider.capabilities._tag === "AtomicBatch" && dynamic !== undefined) {
          return yield* Effect.fail(
            new ProviderMismatch({ dialect: provider.dialect, mode: dynamic._tag }),
          );
        }
        migrations.push({
          id: migration.id,
          name: migration.name,
          risk: migration.risk,
          operations,
        });
      }
      capsules.push({ id: capsule.id, migrations });
    }

    const tables = yield* tablesOf(options.prefix);
    return Object.freeze({
      provider,
      capsules: Object.freeze(capsules),
      allowDestructive: options.allowDestructive ?? false,
      allowLegacyLedgerUpgrade: options.allowLegacyLedgerUpgrade ?? false,
      ledger: tables.ledger,
      metadata: tables.metadata,
      manifest: yield* buildManifest({ capsules: options.capsules }),
    });
  });

/**
 * Verify a published manifest and plan its SQL bodies for the provider.
 *
 * A manifest carries only an Effect step's revision, never its code, so a
 * migration with one cannot be applied from here; it fails exactly as `emit`
 * refuses it, and that capsule is prepared from its definition instead.
 */
const resolveManifest = (options: ManifestOptions): Effect.Effect<Registry, RegistryError> =>
  Effect.gen(function* () {
    const provider = yield* makeProviderProfile(options.provider);
    const manifest = yield* decodeManifest(options.manifest);

    const capsules: Array<PlannedCapsule> = [];
    for (const capsule of manifest.capsules) {
      const migrations: Array<PlannedMigration> = [];
      for (const migration of capsule.migrations) {
        const body = bodyFor(migration, provider.dialect);
        if (body === undefined) {
          return yield* Effect.fail(
            new MissingProviderMigration({
              migrationId: migration.id,
              dialect: provider.dialect,
            }),
          );
        }
        const operations: Array<Operation> = [];
        for (const operation of body.operations) {
          if (operation._tag !== "Sql") {
            return yield* Effect.fail(
              new InvalidDefinition({
                subject: `manifest ${capsule.id} migration ${migration.id}`,
                reason:
                  "an Effect migration step has no SQL form; prepare this capsule from its definition",
              }),
            );
          }
          operations.push({ _tag: "Sql", statements: operation.statements });
        }
        migrations.push({
          id: migration.id,
          name: migration.name,
          risk: migration.risk,
          operations,
        });
      }
      capsules.push({ id: capsule.id, migrations });
    }

    const tables = yield* tablesOf(options.prefix);
    return Object.freeze({
      provider,
      capsules: Object.freeze(capsules),
      allowDestructive: options.allowDestructive ?? false,
      allowLegacyLedgerUpgrade: options.allowLegacyLedgerUpgrade ?? false,
      ledger: tables.ledger,
      metadata: tables.metadata,
      manifest,
    });
  });

const resolve = (options: Options | ManifestOptions): Effect.Effect<Registry, RegistryError> =>
  ("manifest" in options ? resolveManifest(options) : resolveCapsules(options)).pipe(
    Effect.withSpan("capsuledb.registry.resolve"),
  );

/** Build the deterministic manifest for a composition without touching a database. */
export const manifest = (options: Options): Effect.Effect<Manifest, RegistryError> =>
  resolve(options).pipe(Effect.map((registry) => registry.manifest));

interface LedgerRow {
  readonly capsule_id: string;
  readonly migration_id: number;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: string;
  readonly provider: string;
  /**
   * The dialect this row's checksum is keyed to. `null` marks a manifest v1
   * row, whose checksum covered every dialect body at once; those rows are
   * upgraded in place the first time a v2 runtime prepares against them.
   */
  readonly dialect: string | null;
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
  dialect: Schema.NullOr(Schema.String),
});
const MetadataRowSchema = Schema.Struct({
  id: Schema.Literal(1),
  fingerprint: Schema.String.pipe(Schema.check(Schema.isLengthBetween(64, 64))),
  provider: Schema.String,
});
const CatalogCountSchema = Schema.Struct({
  count: Schema.Union([Schema.Number, Schema.String]),
});

const ensureRuntimeTables = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<void, SqlError> =>
  Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS "${registry.ledger}" (
      capsule_id TEXT NOT NULL,
      migration_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'sqlite',
      dialect TEXT,
      PRIMARY KEY (capsule_id, migration_id)
    )`);
    yield* addDialectColumn(sql, registry);
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS "${registry.metadata}" (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fingerprint TEXT NOT NULL,
      provider TEXT NOT NULL
    )`);
  });

/**
 * Add the manifest v2 `dialect` column to a ledger created by an earlier
 * release. The catalog check keeps this idempotent without swallowing real
 * errors from `ALTER TABLE`.
 */
const addDialectColumn = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<void, SqlError> =>
  Effect.gen(function* () {
    const rows =
      registry.provider.dialect === "postgres"
        ? yield* sql`SELECT COUNT(*)::int AS count FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = ${registry.ledger} AND column_name = 'dialect'`
        : yield* sql`SELECT COUNT(*) AS count FROM pragma_table_info(${registry.ledger})
            WHERE name = 'dialect'`;
    const count = rows[0];
    if (count === undefined) return;
    const decoded = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(CatalogCountSchema)(count),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (decoded !== undefined && Number(decoded.count) > 0) return;
    yield* sql.unsafe(`ALTER TABLE "${registry.ledger}" ADD COLUMN dialect TEXT`);
  });

/** Inspect catalog metadata without creating or mutating CapsuleDB tables. */
const runtimeTablesExist = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<"none" | "partial" | "complete", SqlError> =>
  Effect.gen(function* () {
    const { ledger: LEDGER_TABLE, metadata: METADATA_TABLE } = registry;
    const rows =
      registry.provider.dialect === "postgres"
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
  registry: Registry,
): Effect.Effect<MetadataRow | undefined, SqlError | RegistryCorrupt> =>
  Effect.gen(function* () {
    const rows = yield* sql`SELECT id, fingerprint, provider
      FROM ${sql(registry.metadata)} WHERE id = 1`;
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(MetadataRowSchema))(rows).pipe(
      Effect.mapError(
        (cause) => new RegistryCorrupt({ operation: "read metadata", reason: String(cause) }),
      ),
    );
    return decoded[0];
  });

const readLedger = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  capsuleId: string,
  migrationId: number,
): Effect.Effect<LedgerRow | undefined, SqlError | RegistryCorrupt> =>
  Effect.gen(function* () {
    const rows =
      yield* sql`SELECT capsule_id, migration_id, name, checksum, applied_at, provider, dialect
      FROM ${sql(registry.ledger)}
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
  registry: Registry,
): Effect.Effect<ReadonlyArray<LedgerRow>, SqlError | RegistryCorrupt> =>
  sql`SELECT capsule_id, migration_id, name, checksum, applied_at, provider, dialect
    FROM ${sql(registry.ledger)} ORDER BY capsule_id, migration_id`.pipe(
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

const manifestMigrationOf = (registry: Registry, capsuleId: string, migrationId: number) =>
  registry.manifest.capsules
    .find((candidate) => candidate.id === capsuleId)
    ?.migrations.find((candidate) => candidate.id === migrationId);

/**
 * The manifest body this registry's dialect applies, and the only checksum a
 * host on this dialect ever verifies.
 */
const manifestBodyOf = (
  registry: Registry,
  capsuleId: string,
  migrationId: number,
): ManifestBody | undefined => {
  const migration = manifestMigrationOf(registry, capsuleId, migrationId);
  return migration === undefined ? undefined : bodyFor(migration, registry.provider.dialect);
};

/** A v1 ledger row predates per-dialect checksums and is upgraded in place. */
const isLegacyRow = (row: LedgerRow): boolean => row.dialect === null;

/**
 * A metadata fingerprint is only meaningful when every expected active ledger
 * row is present and still agrees with the current manifest. Rows for capsules
 * removed from the registry are deliberately ignored and preserved.
 */
const hasCompleteLedger = (registry: Registry, ledgerRows: ReadonlyArray<LedgerRow>): boolean => {
  const activeRows = activeLedgerRows(registry, ledgerRows);
  if (activeRows.length !== expectedMigrationCount(registry)) return false;

  for (const capsule of registry.capsules) {
    for (const migration of capsule.migrations) {
      const body = manifestBodyOf(registry, capsule.id, migration.id);
      const ledgerRow = activeRows.find(
        (candidate) =>
          candidate.capsule_id === capsule.id && candidate.migration_id === migration.id,
      );
      if (
        body === undefined ||
        ledgerRow === undefined ||
        ledgerRow.name !== migration.name ||
        ledgerRow.provider !== providerName(registry.provider.provider) ||
        ledgerRow.applied_at.length === 0
      ) {
        return false;
      }
      // A row still carrying a v1 checksum is not fully recorded, whatever the
      // operator authorized. Readiness must not depend on a re-key that has not
      // been persisted, or an interrupted upgrade would read as Ready.
      if (isLegacyRow(ledgerRow) || ledgerRow.checksum !== body.checksum) return false;
    }
  }
  return true;
};

/** Validate all known ledger rows before any new migration can mutate state. */
const validateExistingLedger = (
  registry: Registry,
  ledgerRows: ReadonlyArray<LedgerRow>,
): Effect.Effect<
  void,
  DatabaseAhead | LedgerConflict | LegacyLedgerUpgradeUnauthorized | ProviderMismatch
> =>
  Effect.gen(function* () {
    const expectedProvider = providerName(registry.provider.provider);
    for (const row of ledgerRows) {
      const capsule = registry.capsules.find((candidate) => candidate.id === row.capsule_id);
      // A removed capsule retains its ledger rows and physical objects. It is
      // intentionally outside the active registry until it is re-registered.
      if (capsule === undefined) continue;

      const migration = capsule.migrations.find((candidate) => candidate.id === row.migration_id);
      const body = manifestBodyOf(registry, row.capsule_id, row.migration_id);
      if (row.provider !== expectedProvider) {
        return yield* Effect.fail(
          new ProviderMismatch({ dialect: expectedProvider, mode: row.provider }),
        );
      }
      if (migration === undefined || body === undefined) {
        return yield* Effect.fail(
          new DatabaseAhead({
            capsuleId: row.capsule_id,
            migrationId: row.migration_id,
            name: row.name,
          }),
        );
      }
      if (row.name !== migration.name) {
        return yield* Effect.fail(
          new LedgerConflict({
            capsuleId: row.capsule_id,
            migrationId: row.migration_id,
            dialect: registry.provider.dialect,
            expected: body.checksum,
            actual: row.checksum,
          }),
        );
      }
      // A v1 row carries a checksum over every dialect body, which no v2
      // manifest can reproduce, so only its logical identity carries over. That
      // is a weaker guarantee than every other row gets, so it takes an
      // explicit opt-in rather than happening silently.
      if (isLegacyRow(row)) {
        if (registry.allowLegacyLedgerUpgrade) continue;
        return yield* Effect.fail(
          new LegacyLedgerUpgradeUnauthorized({
            capsuleId: row.capsule_id,
            migrationId: row.migration_id,
          }),
        );
      }
      if (row.checksum !== body.checksum) {
        return yield* Effect.fail(
          new LedgerConflict({
            capsuleId: row.capsule_id,
            migrationId: row.migration_id,
            dialect: registry.provider.dialect,
            expected: body.checksum,
            actual: row.checksum,
          }),
        );
      }
    }
  });

const writeMetadata = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  provider: string,
): Effect.Effect<void, SqlError> =>
  sql`INSERT INTO ${sql(registry.metadata)} (id, fingerprint, provider)
    VALUES (1, ${registry.manifest.fingerprint}, ${provider})
    ON CONFLICT(id) DO UPDATE SET
      fingerprint = excluded.fingerprint,
      provider = excluded.provider`;

const unauthorizedDestructive = (
  capsule: PlannedCapsule,
  migration: PlannedMigration,
  registry: Registry,
): Effect.Effect<void, DestructiveMigrationUnauthorized> =>
  migration.risk === "destructive" && !registry.allowDestructive
    ? Effect.fail(
        new DestructiveMigrationUnauthorized({
          capsuleId: capsule.id,
          migrationId: migration.id,
          name: migration.name,
        }),
      )
    : Effect.void;

const ledgerConflict = (
  registry: Registry,
  capsule: PlannedCapsule,
  migration: PlannedMigration,
  expected: string,
  actual: string,
): LedgerConflict =>
  new LedgerConflict({
    capsuleId: capsule.id,
    migrationId: migration.id,
    dialect: registry.provider.dialect,
    expected,
    actual,
  });

const applyTransactional = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  capsule: PlannedCapsule,
  migration: PlannedMigration,
  checksum: string,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    const operations = migration.operations;
    const outcome = yield* runTransactionalMigration({
      sql,
      capsuleId: capsule.id,
      migrationId: migration.id,
      name: migration.name,
      checksum,
      provider: providerName(registry.provider.provider),
      dialect: registry.provider.dialect,
      operations,
      ledgerTable: registry.ledger,
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
      return yield* reconcileFailedClaim(
        sql,
        registry,
        capsule,
        migration,
        checksum,
        outcome.error,
      );
    }
  }).pipe(Effect.withSpan("capsuledb.registry.apply"));

const applyD1 = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  capsule: PlannedCapsule,
  migration: PlannedMigration,
  checksum: string,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    const operations = migration.operations;
    const outcome = yield* runD1Migration({
      sql: sql as D1BatchClient,
      profile: registry.provider,
      capsuleId: capsule.id,
      migrationId: migration.id,
      name: migration.name,
      checksum,
      provider: providerName(registry.provider.provider),
      dialect: registry.provider.dialect,
      operations,
      ledgerTable: registry.ledger,
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ _tag: "Failure" as const, error }),
        onSuccess: () => ({ _tag: "Success" as const }),
      }),
    );

    if (outcome._tag === "Failure") {
      return yield* reconcileFailedClaim(
        sql,
        registry,
        capsule,
        migration,
        checksum,
        outcome.error,
      );
    }

    yield* Effect.logDebug("CapsuleDB D1 migration applied").pipe(
      Effect.annotateLogs("capsule_id", capsule.id),
      Effect.annotateLogs("migration_id", String(migration.id)),
      Effect.annotateLogs("outcome", "apply"),
    );
  }).pipe(Effect.withSpan("capsuledb.registry.apply.d1"));

/**
 * A failed claim can mean a concurrent run already applied the same migration.
 * Re-read the ledger: an identical row converges, a different row is a real
 * conflict, and no row at all re-raises the original failure.
 */
const reconcileFailedClaim = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  capsule: PlannedCapsule,
  migration: PlannedMigration,
  checksum: string,
  error: RegistryRuntimeError,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    const reread = yield* readLedger(sql, registry, capsule.id, migration.id);
    if (reread === undefined) return yield* Effect.fail(error);
    if (reread.checksum === checksum && reread.name === migration.name) {
      yield* Effect.logDebug("CapsuleDB migration conflict converged").pipe(
        Effect.annotateLogs("capsule_id", capsule.id),
        Effect.annotateLogs("migration_id", String(migration.id)),
        Effect.annotateLogs("outcome", "retry"),
      );
      return;
    }
    yield* Effect.logWarning("CapsuleDB migration ledger diverged").pipe(
      Effect.annotateLogs("capsule_id", capsule.id),
      Effect.annotateLogs("migration_id", String(migration.id)),
      Effect.annotateLogs("outcome", "divergence"),
    );
    return yield* Effect.fail(
      ledgerConflict(registry, capsule, migration, checksum, reread.checksum),
    );
  });

const missingManifestMigration = (
  registry: Registry,
  capsuleId: string,
  migrationId: number,
): PartialMigration =>
  new PartialMigration({
    capsuleId,
    migrationId,
    reason: `the manifest for fingerprint ${registry.manifest.fingerprint} has no entry for this migration`,
  });

/**
 * Validate every pending D1 batch before the first migration can mutate the
 * database. Applying one batch at a time is necessary for D1's atomicity, but
 * without this pass a later oversized or unsupported migration could leave an
 * earlier migration committed before preparation failed.
 */
const preflightD1Pending = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  ledgerRows: ReadonlyArray<LedgerRow>,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    for (const capsule of registry.capsules) {
      for (const migration of capsule.migrations) {
        const existing = ledgerRows.find(
          (row) => row.capsule_id === capsule.id && row.migration_id === migration.id,
        );
        if (existing !== undefined) continue;

        const body = manifestBodyOf(registry, capsule.id, migration.id);
        if (body === undefined) {
          return yield* Effect.fail(missingManifestMigration(registry, capsule.id, migration.id));
        }
        yield* compileD1Migration({
          sql: sql as D1BatchClient,
          profile: registry.provider,
          capsuleId: capsule.id,
          migrationId: migration.id,
          name: migration.name,
          checksum: body.checksum,
          provider: providerName(registry.provider.provider),
          dialect: registry.provider.dialect,
          operations: migration.operations,
          ledgerTable: registry.ledger,
        });
      }
    }
  });

const applyPending = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    for (const capsule of registry.capsules) {
      for (const migration of capsule.migrations) {
        const body = manifestBodyOf(registry, capsule.id, migration.id);
        if (body === undefined) {
          return yield* Effect.fail(missingManifestMigration(registry, capsule.id, migration.id));
        }
        const existing = yield* readLedger(sql, registry, capsule.id, migration.id);
        if (existing !== undefined) {
          if (
            existing.name !== migration.name ||
            (!isLegacyRow(existing) && existing.checksum !== body.checksum)
          ) {
            return yield* Effect.fail(
              ledgerConflict(registry, capsule, migration, body.checksum, existing.checksum),
            );
          }
          continue;
        }
        if (registry.provider.capabilities._tag === "AtomicBatch") {
          yield* applyD1(sql, registry, capsule, migration, body.checksum);
        } else {
          yield* applyTransactional(sql, registry, capsule, migration, body.checksum);
        }
      }
    }
  });

/**
 * Rewrite manifest v1 ledger rows to this dialect's checksum.
 *
 * A v1 checksum hashed every dialect body of a migration together, which is
 * exactly the bug per-dialect checksums fix, and no v2 manifest can reproduce
 * it. The upgrade therefore trusts the row's logical identity — capsule, id,
 * and name, all already validated — and re-keys the checksum to the body this
 * host actually applies. It runs once: a row that has a dialect is never
 * touched again.
 */
/**
 * The ledger as it will read once authorized legacy rows are re-keyed.
 *
 * Preparation decides against this view and persists the rewrite inside the
 * same transaction as the rest of its work, so a run that fails afterwards
 * leaves the original rows exactly where they were.
 */
const upgradedLedgerRows = (
  registry: Registry,
  ledgerRows: ReadonlyArray<LedgerRow>,
): ReadonlyArray<LedgerRow> => {
  if (!registry.allowLegacyLedgerUpgrade) return ledgerRows;
  return ledgerRows.map((row) => {
    if (!isLegacyRow(row)) return row;
    const body = manifestBodyOf(registry, row.capsule_id, row.migration_id);
    return body === undefined
      ? row
      : { ...row, checksum: body.checksum, dialect: registry.provider.dialect };
  });
};

const rewriteLegacyRows = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  ledgerRows: ReadonlyArray<LedgerRow>,
): Effect.Effect<void, RegistryRuntimeError> =>
  Effect.gen(function* () {
    if (!registry.allowLegacyLedgerUpgrade) return;
    for (const row of ledgerRows) {
      if (!isLegacyRow(row)) continue;
      const body = manifestBodyOf(registry, row.capsule_id, row.migration_id);
      if (body === undefined) continue;

      // `dialect IS NULL` keeps a concurrent preparation that already re-keyed
      // this row from being overwritten with a second, redundant rewrite.
      yield* sql`UPDATE ${sql(registry.ledger)}
        SET checksum = ${body.checksum}, dialect = ${registry.provider.dialect}
        WHERE capsule_id = ${row.capsule_id}
          AND migration_id = ${row.migration_id}
          AND dialect IS NULL`;
      yield* Effect.logInfo("CapsuleDB ledger row upgraded to a per-dialect checksum").pipe(
        Effect.annotateLogs("capsule_id", row.capsule_id),
        Effect.annotateLogs("migration_id", String(row.migration_id)),
        Effect.annotateLogs("dialect", registry.provider.dialect),
      );
    }
  });

const pendingMigrations = (
  registry: Registry,
  ledgerRows: ReadonlyArray<LedgerRow>,
): ReadonlyArray<PendingMigration> => {
  const pending: Array<PendingMigration> = [];
  for (const capsule of registry.capsules) {
    for (const migration of capsule.migrations) {
      const row = ledgerRows.find(
        (candidate) =>
          candidate.capsule_id === capsule.id && candidate.migration_id === migration.id,
      );
      if (row === undefined) {
        pending.push({ capsule: capsule.id, migration: migration.id, name: migration.name });
      }
    }
  }
  return pending;
};

const ready = (registry: Registry): Ready => ({
  _tag: "Ready",
  fingerprint: registry.manifest.fingerprint,
  provider: providerName(registry.provider.provider),
  capsules: registry.capsules.length,
});

const drift = (registry: Registry, reason: string): Readiness => ({
  _tag: "Drift",
  fingerprint: registry.manifest.fingerprint,
  reason,
});

const pending = (registry: Registry, ledgerRows: ReadonlyArray<LedgerRow>): Readiness => ({
  _tag: "Pending",
  fingerprint: registry.manifest.fingerprint,
  pending: pendingMigrations(registry, ledgerRows),
});

const eitherOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.match({
      onFailure: (left) => ({ _tag: "Left" as const, left }),
      onSuccess: (right) => ({ _tag: "Right" as const, right }),
    }),
  );

/** Readiness metadata and every ledger row, as one statement reads them. */
interface Snapshot {
  readonly metadata: MetadataRow | undefined;
  readonly ledgerRows: ReadonlyArray<LedgerRow>;
}

const SnapshotRowSchema = Schema.Struct({
  kind: Schema.Union([Schema.Literal("metadata"), Schema.Literal("ledger")]),
  capsule_id: Schema.NullOr(Schema.String),
  migration_id: Schema.NullOr(Schema.Number),
  name: Schema.NullOr(Schema.String),
  checksum: Schema.String,
  applied_at: Schema.NullOr(Schema.String),
  provider: Schema.String,
  dialect: Schema.NullOr(Schema.String),
});

const decodeSnapshot = (rows: ReadonlyArray<unknown>): Effect.Effect<Snapshot, unknown> =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(SnapshotRowSchema))(rows);
    const metadata = yield* Schema.decodeUnknownEffect(Schema.Array(MetadataRowSchema))(
      decoded
        .filter((row) => row.kind === "metadata")
        .map((row) => ({ id: 1, fingerprint: row.checksum, provider: row.provider })),
    );
    const ledgerRows = yield* Schema.decodeUnknownEffect(Schema.Array(LedgerRowSchema))(
      decoded.filter((row) => row.kind === "ledger").map(({ kind: _kind, ...row }) => row),
    );
    return { metadata: metadata[0], ledgerRows };
  });

/**
 * Read readiness metadata and the whole ledger in a single round trip.
 *
 * This is the steady-state read: a registry that is already current answers
 * from it alone. It yields `undefined` whenever the read cannot be trusted —
 * the tables are missing, a ledger predates the `dialect` column, or a row does
 * not decode — and the caller falls back to the catalog-checked path, which
 * reports each of those precisely. Inside a caller's transaction the read runs
 * under a savepoint, so an expected failure cannot abort that transaction.
 */
const readSnapshot = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<Snapshot | undefined> => {
  const read = sql`SELECT 'metadata' AS kind, NULL AS capsule_id, NULL AS migration_id,
      NULL AS name, fingerprint AS checksum, NULL AS applied_at, provider, NULL AS dialect
    FROM ${sql(registry.metadata)} WHERE id = 1
    UNION ALL
    SELECT 'ledger' AS kind, capsule_id, migration_id, name, checksum, applied_at, provider,
      dialect
    FROM ${sql(registry.ledger)}
    ORDER BY kind, capsule_id, migration_id`.pipe(Effect.flatMap(decodeSnapshot));
  return Effect.serviceOption(sql.transactionService).pipe(
    Effect.flatMap((transaction) =>
      transaction._tag === "Some" ? sql.withTransaction(read) : read,
    ),
    Effect.match({ onFailure: () => undefined, onSuccess: (snapshot) => snapshot }),
  );
};

/**
 * Read the current host-owned readiness without constructing or mutating
 * CapsuleDB tables. Every disagreement the runtime cannot repair by applying
 * pending migrations is reported as `Drift`.
 */
const readReadiness = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<Readiness, SqlError> =>
  Effect.gen(function* () {
    const snapshot = yield* readSnapshot(sql, registry);
    if (snapshot !== undefined) return yield* readinessOf(registry, snapshot);

    const tablesExist = yield* runtimeTablesExist(sql, registry);
    if (tablesExist === "none") return pending(registry, []);
    if (tablesExist === "partial") return drift(registry, "registry tables are incomplete");

    const metadataResult = yield* eitherOf(readMetadata(sql, registry));
    if (metadataResult._tag === "Left") return drift(registry, String(metadataResult.left));
    const ledgerResult = yield* eitherOf(readLedgerRows(sql, registry));
    if (ledgerResult._tag === "Left") return drift(registry, String(ledgerResult.left));

    return yield* readinessOf(registry, {
      metadata: metadataResult.right,
      ledgerRows: ledgerResult.right,
    });
  });

/** Judge readiness from metadata and ledger rows that have already been read. */
const readinessOf = (
  registry: Registry,
  { metadata, ledgerRows }: Snapshot,
): Effect.Effect<Readiness> =>
  Effect.gen(function* () {
    const expectedProvider = providerName(registry.provider.provider);
    if (metadata === undefined && ledgerRows.length === 0) return pending(registry, []);
    if (metadata === undefined) {
      return drift(registry, "registry ledger exists without readiness metadata");
    }
    if (metadata.provider !== expectedProvider) {
      return drift(
        registry,
        `provider mismatch: expected ${expectedProvider}, found ${metadata.provider}`,
      );
    }

    const validation = yield* eitherOf(validateExistingLedger(registry, ledgerRows));
    if (validation._tag === "Left") {
      const error = validation.left;
      switch (error._tag) {
        case "DatabaseAhead":
          return drift(
            registry,
            `the database has migration ${error.migrationId} (${error.name}) for capsule ${error.capsuleId}, which this code does not define`,
          );
        case "ProviderMismatch":
          return drift(
            registry,
            `the ledger is stamped for provider ${error.mode}, not ${error.dialect}`,
          );
        case "LedgerConflict":
          return drift(
            registry,
            `migration ${error.migrationId} of capsule ${error.capsuleId} was applied with checksum ${error.actual}, but the code now describes ${error.expected}`,
          );
        case "LegacyLedgerUpgradeUnauthorized":
          return drift(
            registry,
            `migration ${error.migrationId} of capsule ${error.capsuleId} was applied before per-dialect checksums; confirm its history is unchanged and set allowLegacyLedgerUpgrade`,
          );
      }
    }

    // Reachable only with `allowLegacyLedgerUpgrade` set: without it the
    // validation above already reported the unauthorized row. One more
    // preparation finishes the re-key.
    if (activeLedgerRows(registry, ledgerRows).some(isLegacyRow)) {
      return drift(
        registry,
        "some ledger rows still carry a checksum from before per-dialect checksums; run one preparation to finish re-keying them",
      );
    }

    const complete = hasCompleteLedger(registry, ledgerRows);
    if (metadata.fingerprint === registry.manifest.fingerprint) {
      return complete
        ? ready(registry)
        : drift(
            registry,
            "readiness metadata claims the registry is complete but its ledger is incomplete",
          );
    }
    return complete ? ready(registry) : pending(registry, ledgerRows);
  });

/** Report readiness for a composition without applying anything. */
export const status = (
  options: Options | ManifestOptions,
): Effect.Effect<Readiness, RegistryError | SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registry = yield* resolve(options);
    return yield* readReadiness(yield* Effect.service(SqlClient.SqlClient), registry);
  }).pipe(Effect.withSpan("capsuledb.registry.status"));

const preparePostgres = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  rewriteLegacy: Effect.Effect<void, RegistryRuntimeError>,
): Effect.Effect<void, RegistryRuntimeError> =>
  sql.withTransaction(
    Effect.gen(function* () {
      // PostgreSQL advisory locks are database-wide and transaction-scoped.
      // The stable key serializes every CapsuleDB registry on this database.
      yield* sql`SELECT pg_advisory_xact_lock(${45_120_617})`;
      const rows = yield* readLedgerRows(sql, registry);
      yield* validateExistingLedger(registry, rows);
      yield* rewriteLegacy;
      yield* applyPending(sql, registry);
      yield* writeMetadata(sql, registry, providerName(registry.provider.provider));
    }),
  );

const initializePostgres = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<void, SqlError> =>
  sql.withTransaction(
    Effect.gen(function* () {
      // The advisory lock must cover first-use DDL as well as migration DDL;
      // PostgreSQL can still race two CREATE TABLE IF NOT EXISTS statements
      // while registering the table's row type.
      yield* sql`SELECT pg_advisory_xact_lock(${45_120_617})`;
      yield* ensureRuntimeTables(sql, registry);
    }),
  );

const prepareRegistry = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<Ready, RegistryRuntimeError> =>
  Effect.gen(function* () {
    // A current registry is the common case at boot, and it needs no lock, no
    // DDL, and no transaction: one read proves the recorded fingerprint and a
    // complete, re-keyed ledger. Anything short of that takes the locked path.
    const snapshot = yield* readSnapshot(sql, registry);
    if (
      snapshot?.metadata?.fingerprint === registry.manifest.fingerprint &&
      (yield* readinessOf(registry, snapshot))._tag === "Ready"
    ) {
      yield* Effect.logDebug("CapsuleDB registry ready").pipe(
        Effect.annotateLogs("provider", providerName(registry.provider.provider)),
        Effect.annotateLogs("outcome", "current"),
      );
      return ready(registry);
    }

    if (registry.provider.dialect === "postgres") {
      yield* initializePostgres(sql, registry);
    } else {
      yield* ensureRuntimeTables(sql, registry);
    }

    const initialRows = yield* readLedgerRows(sql, registry);
    yield* validateExistingLedger(registry, initialRows);

    const metadata = yield* readMetadata(sql, registry);
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

    // Decide against the ledger as it will read after an authorized re-key.
    // Nothing is written yet: the rewrite rides along with whichever
    // transaction this run ends up opening.
    const ledgerRows = upgradedLedgerRows(registry, initialRows);
    const rewriteLegacy = rewriteLegacyRows(sql, registry, initialRows);

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
        hasCompleteLedger(registry, ledgerRows)
      ) {
        // This recovery path is D1-only and has no transaction either, so the
        // re-key goes after the metadata write for the same reason: a failure
        // must leave every original checksum in place for the next run.
        yield* writeMetadata(sql, registry, expectedProvider);
        yield* rewriteLegacy;
        return ready(registry);
      }
      return yield* Effect.fail(
        new PartialMigration({
          capsuleId: firstLedgerRow.capsule_id,
          migrationId: firstLedgerRow.migration_id,
          reason: "migration ledger contains rows but readiness metadata is missing",
        }),
      );
    }

    const complete = hasCompleteLedger(registry, ledgerRows);
    if (metadata?.fingerprint === registry.manifest.fingerprint && !complete) {
      const incomplete = pendingMigrations(registry, ledgerRows)[0];
      if (incomplete !== undefined) {
        return yield* Effect.fail(
          new PartialMigration({
            capsuleId: incomplete.capsule,
            migrationId: incomplete.migration,
            reason:
              "readiness metadata claims the registry is complete but its ledger is incomplete",
          }),
        );
      }
    }

    if (metadata?.fingerprint === registry.manifest.fingerprint && complete) {
      // Nothing to apply, so the re-key is the only write and gets its own
      // transaction.
      yield* registry.provider.capabilities._tag === "Transactional"
        ? sql.withTransaction(rewriteLegacy)
        : rewriteLegacy;
      yield* Effect.logDebug("CapsuleDB registry ready").pipe(
        Effect.annotateLogs("provider", expectedProvider),
        Effect.annotateLogs("outcome", "ready"),
      );
      return ready(registry);
    }

    // Refuse every pending destructive operation before applying any earlier
    // additive migration in this run.
    for (const capsule of registry.capsules) {
      for (const migration of capsule.migrations) {
        const existing = ledgerRows.find(
          (row) => row.capsule_id === capsule.id && row.migration_id === migration.id,
        );
        if (existing === undefined) {
          yield* unauthorizedDestructive(capsule, migration, registry);
        }
      }
    }

    if (registry.provider.capabilities._tag === "AtomicBatch") {
      yield* preflightD1Pending(sql, registry, ledgerRows);
    }

    if (registry.provider.dialect === "postgres") {
      yield* preparePostgres(sql, registry, rewriteLegacy);
    } else if (registry.provider.capabilities._tag === "Transactional") {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* rewriteLegacy;
          yield* applyPending(sql, registry);
          yield* writeMetadata(sql, registry, expectedProvider);
        }),
      );
    } else {
      // D1 has no interactive transaction, so the re-key cannot share one. It
      // goes last instead: `applyPending` already skips a legacy row it can
      // still identify, so a failure before this point leaves every original
      // checksum in place and the next run retries.
      yield* applyPending(sql, registry);
      yield* writeMetadata(sql, registry, expectedProvider);
      yield* rewriteLegacy;
    }

    yield* Effect.logDebug("CapsuleDB registry ready").pipe(
      Effect.annotateLogs("provider", expectedProvider),
      Effect.annotateLogs("outcome", "ready"),
    );
    return ready(registry);
  });

/**
 * Apply all pending migrations using the host's existing SQL client.
 *
 * Transactional providers use their driver's transaction/savepoint behavior;
 * PostgreSQL additionally serializes preparation with a database-wide
 * transaction-scoped advisory lock. D1 uses only its atomic claim-first batch.
 * CapsuleDB never opens or closes the host client.
 */
export const prepare = (
  options: Options | ManifestOptions,
): Effect.Effect<Ready, RegistryRuntimeError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registry = yield* resolve(options);
    return yield* prepareRegistry(yield* Effect.service(SqlClient.SqlClient), registry);
  }).pipe(Effect.withSpan("capsuledb.registry.prepare"));

const assertRegistry = (
  sql: SqlClient.SqlClient,
  registry: Registry,
): Effect.Effect<Ready, SqlError | NotReady> =>
  Effect.gen(function* () {
    const readiness = yield* readReadiness(sql, registry);
    if (readiness._tag === "Ready") return readiness;
    return yield* Effect.fail(
      new NotReady({
        expectedFingerprint: registry.manifest.fingerprint,
        actualFingerprint: readiness._tag === "Drift" ? readiness.fingerprint : "",
        reason:
          readiness._tag === "Drift"
            ? readiness.reason
            : `${readiness.pending.length} migration(s) have not been applied`,
      }),
    );
  });

/** Assert an already-prepared registry without applying any migration. */
export const assert = (
  options: Options | ManifestOptions,
): Effect.Effect<Ready, RegistryRuntimeError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const registry = yield* resolve(options);
    return yield* assertRegistry(yield* Effect.service(SqlClient.SqlClient), registry);
  }).pipe(Effect.withSpan("capsuledb.registry.assert"));

/** The readiness check `mode` selects, against an already-resolved registry. */
const checkRegistry = (
  sql: SqlClient.SqlClient,
  registry: Registry,
  mode: Options["mode"],
): Effect.Effect<Ready, RegistryRuntimeError> =>
  mode === "assert"
    ? assertRegistry(sql, registry).pipe(Effect.withSpan("capsuledb.registry.assert"))
    : prepareRegistry(sql, registry).pipe(Effect.withSpan("capsuledb.registry.prepare"));

/**
 * One Layer that checks the registry and provides each capsule's service.
 *
 * `mode` picks the check: `prepare` applies pending migrations, and `assert`
 * applies nothing and fails unless the database already matches the registered
 * history — the path for a host that prepared the database at deploy time or
 * applied `capsuledb emit` output through its own migration pipeline.
 *
 * `readiness` picks when the check runs:
 *
 * - `boot` (default) runs it while the Layer is built, so the Layer fails
 *   instead of providing capsules over a database that is not ready.
 * - `first-use` builds the Layer without touching the database. Capsules
 *   receive the host client wrapped so that their first connection runs the
 *   check; a success is kept for the Layer's lifetime, and a failure reaches the
 *   capsule query as a `SqlError` whose cause is the registry error, then runs
 *   again on the next use. Composition errors still fail the Layer build. This
 *   keeps a serverless cold start that never touches a capsule free of registry
 *   work.
 *
 * The host still owns the `SqlClient` this layer consumes, along with anything
 * else the capsule layers require.
 */
export const layer = <const Caps extends ReadonlyArray<AnyCapsule>>(
  options: Options<Caps>,
): Layer.Layer<
  Services<Caps>,
  Failures<Caps> | RegistryRuntimeError,
  Requirements<Caps> | SqlClient.SqlClient
> => {
  const services = options.capsules.map(
    (capsule) => capsule.layer as Layer.Layer<never, unknown, unknown>,
  );
  const merged =
    services.length === 0
      ? Layer.empty
      : services.reduce((left, right) => Layer.merge(left, right));
  const checked =
    options.readiness === "first-use"
      ? merged.pipe(
          Layer.provide(
            Layer.effect(
              SqlClient.SqlClient,
              Effect.gen(function* () {
                const registry = yield* resolve(options);
                const sql = yield* Effect.service(SqlClient.SqlClient);
                return yield* GatedClient.make(sql, checkRegistry(sql, registry, options.mode));
              }),
            ),
          ),
        )
      : merged.pipe(
          Layer.provide(
            Layer.effectDiscard(
              Effect.gen(function* () {
                const registry = yield* resolve(options);
                const sql = yield* Effect.service(SqlClient.SqlClient);
                yield* checkRegistry(sql, registry, options.mode);
              }),
            ),
          ),
        );
  return checked as Layer.Layer<
    Services<Caps>,
    Failures<Caps> | RegistryRuntimeError,
    Requirements<Caps> | SqlClient.SqlClient
  >;
};
