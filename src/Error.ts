import { Schema } from "effect";

/**
 * A capsule, migration, or table definition is invalid.
 *
 * The definition constructors are pure and validate eagerly, so they throw this
 * error instead of returning it. A definition is authored code, not input: a
 * bad one is a defect the author fixes, and making every capsule a module
 * constant is worth more than routing it through an Effect error channel.
 */
export class CapsuleDefinitionError extends Schema.TaggedError<CapsuleDefinitionError>()(
  "CapsuleDefinitionError",
  { subject: Schema.String, reason: Schema.String },
) {}

/** Two capsule definitions used the same logical identifier. */
export class DuplicateCapsule extends Schema.TaggedError<DuplicateCapsule>()("DuplicateCapsule", {
  capsuleId: Schema.String,
}) {}

/** Two capsule definitions would address the same physical namespace. */
export class NamespaceCollision extends Schema.TaggedError<NamespaceCollision>()(
  "NamespaceCollision",
  { namespace: Schema.String, capsules: Schema.Array(Schema.String) },
) {}

/** A migration identifier was duplicated in one logical history. */
export class DuplicateMigrationId extends Schema.TaggedError<DuplicateMigrationId>()(
  "DuplicateMigrationId",
  { migrationId: Schema.Number },
) {}

/** A migration history skipped a logical identifier. */
export class MigrationHistoryGap extends Schema.TaggedError<MigrationHistoryGap>()(
  "MigrationHistoryGap",
  { expected: Schema.Number, actual: Schema.Number },
) {}

/** A migration history changed the order of existing logical identifiers. */
export class MigrationHistoryReordered extends Schema.TaggedError<MigrationHistoryReordered>()(
  "MigrationHistoryReordered",
  { migrationId: Schema.Number, previousIndex: Schema.Number, nextIndex: Schema.Number },
) {}

/** An already-known logical migration changed its name. */
export class MigrationNameDrift extends Schema.TaggedError<MigrationNameDrift>()(
  "MigrationNameDrift",
  { migrationId: Schema.Number, expected: Schema.String, actual: Schema.String },
) {}

/** An already-known logical migration changed its canonical checksum. */
export class MigrationChecksumDrift extends Schema.TaggedError<MigrationChecksumDrift>()(
  "MigrationChecksumDrift",
  {
    migrationId: Schema.Number,
    /** The dialect whose body drifted; another dialect's body is unaffected. */
    dialect: Schema.String,
    expected: Schema.String,
    actual: Schema.String,
  },
) {}

/** A published manifest's top-level fingerprint does not match its contents. */
export class ManifestFingerprintDrift extends Schema.TaggedError<ManifestFingerprintDrift>()(
  "ManifestFingerprintDrift",
  { expected: Schema.String, actual: Schema.String },
) {}

/** A migration has no implementation for the active provider dialect. */
export class MissingProviderMigration extends Schema.TaggedError<MissingProviderMigration>()(
  "MissingProviderMigration",
  { migrationId: Schema.Number, dialect: Schema.String },
) {}

/** A provider profile advertises an execution capability it cannot support. */
export class UnsupportedCapability extends Schema.TaggedError<UnsupportedCapability>()(
  "UnsupportedCapability",
  { dialect: Schema.String, capability: Schema.String },
) {}

/** A migration body is incompatible with a provider execution profile. */
export class ProviderMismatch extends Schema.TaggedError<ProviderMismatch>()("ProviderMismatch", {
  dialect: Schema.String,
  mode: Schema.String,
}) {}

/** A D1 artifact tried to project a dynamic or otherwise unsupported body. */
export class D1ArtifactUnsupportedBody extends Schema.TaggedError<D1ArtifactUnsupportedBody>()(
  "D1ArtifactUnsupportedBody",
  {
    capsuleId: Schema.String,
    migrationId: Schema.Number,
    mode: Schema.String,
  },
) {}

/** A D1 artifact was produced from a different manifest fingerprint. */
export class D1ArtifactStale extends Schema.TaggedError<D1ArtifactStale>()("D1ArtifactStale", {
  expectedFingerprint: Schema.String,
  actualFingerprint: Schema.String,
}) {}

/** A generated D1 artifact is missing a migration file. */
export class D1ArtifactMigrationMissing extends Schema.TaggedError<D1ArtifactMigrationMissing>()(
  "D1ArtifactMigrationMissing",
  {
    capsuleId: Schema.String,
    migrationId: Schema.Number,
    path: Schema.String,
  },
) {}

/** D1 artifact migration files no longer follow manifest order. */
export class D1ArtifactMigrationReordered extends Schema.TaggedError<D1ArtifactMigrationReordered>()(
  "D1ArtifactMigrationReordered",
  {
    capsuleId: Schema.String,
    migrationId: Schema.Number,
    expectedIndex: Schema.Number,
    actualIndex: Schema.Number,
  },
) {}

/** A D1 artifact file or its metadata differs from the manifest projection. */
export class D1ArtifactMigrationEdited extends Schema.TaggedError<D1ArtifactMigrationEdited>()(
  "D1ArtifactMigrationEdited",
  {
    capsuleId: Schema.String,
    migrationId: Schema.Number,
    expectedChecksum: Schema.String,
    actualChecksum: Schema.String,
  },
) {}

/**
 * A ledger written before per-dialect checksums needs an explicit upgrade.
 *
 * A v1 checksum covered every dialect body at once under a canonicalization
 * this version cannot reproduce, so re-keying a row means trusting its logical
 * identity instead of its content. That is an operator decision.
 */
export class LegacyLedgerUpgradeUnauthorized extends Schema.TaggedError<LegacyLedgerUpgradeUnauthorized>()(
  "LegacyLedgerUpgradeUnauthorized",
  { capsuleId: Schema.String, migrationId: Schema.Number },
) {}

/** An emitted SQL folder no longer matches the projection CapsuleDB produces. */
export class EmitDrift extends Schema.TaggedError<EmitDrift>()("EmitDrift", {
  path: Schema.String,
  reason: Schema.String,
}) {}

/** A migration requires an explicit destructive-operation authorization. */
export class DestructiveMigrationUnauthorized extends Schema.TaggedError<DestructiveMigrationUnauthorized>()(
  "DestructiveMigrationUnauthorized",
  {
    capsuleId: Schema.String,
    migrationId: Schema.Number,
    name: Schema.String,
  },
) {}

/** The database contains a migration that is newer than the registered code. */
export class DatabaseAhead extends Schema.TaggedError<DatabaseAhead>()("DatabaseAhead", {
  capsuleId: Schema.String,
  migrationId: Schema.Number,
  name: Schema.String,
}) {}

/** The ledger and the provider schema no longer describe one complete migration. */
export class PartialMigration extends Schema.TaggedError<PartialMigration>()("PartialMigration", {
  capsuleId: Schema.String,
  migrationId: Schema.Number,
  reason: Schema.String,
}) {}

/** A registry or runtime operation could not validate its definition. */
export class InvalidDefinition extends Schema.TaggedError<InvalidDefinition>()(
  "InvalidDefinition",
  { subject: Schema.String, reason: Schema.String },
) {}

/** Runtime preparation failed before a readiness receipt could be produced. */
export class PreparationFailed extends Schema.TaggedError<PreparationFailed>()(
  "PreparationFailed",
  { reason: Schema.String },
) {}

/** The registered manifest does not match the provider's applied history. */
export class NotReady extends Schema.TaggedError<NotReady>()("NotReady", {
  expectedFingerprint: Schema.String,
  actualFingerprint: Schema.String,
  reason: Schema.String,
}) {}

/** A migration ledger claim conflicted with an incompatible checksum. */
export class LedgerConflict extends Schema.TaggedError<LedgerConflict>()("LedgerConflict", {
  capsuleId: Schema.String,
  migrationId: Schema.Number,
  /** The dialect whose applied body no longer matches the registered one. */
  dialect: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
}) {}

/** A registry-owned persistence row could not be decoded safely. */
export class RegistryCorrupt extends Schema.TaggedError<RegistryCorrupt>()("RegistryCorrupt", {
  operation: Schema.String,
  reason: Schema.String,
}) {}

/** All predictable failures emitted by CapsuleDB's public runtime seams. */
export type CapsuleError =
  | CapsuleDefinitionError
  | DuplicateCapsule
  | NamespaceCollision
  | DuplicateMigrationId
  | MigrationHistoryGap
  | MigrationHistoryReordered
  | MigrationNameDrift
  | MigrationChecksumDrift
  | ManifestFingerprintDrift
  | MissingProviderMigration
  | UnsupportedCapability
  | ProviderMismatch
  | D1ArtifactUnsupportedBody
  | D1ArtifactStale
  | D1ArtifactMigrationMissing
  | D1ArtifactMigrationReordered
  | D1ArtifactMigrationEdited
  | EmitDrift
  | LegacyLedgerUpgradeUnauthorized
  | DestructiveMigrationUnauthorized
  | DatabaseAhead
  | PartialMigration
  | InvalidDefinition
  | PreparationFailed
  | NotReady
  | LedgerConflict
  | RegistryCorrupt;
