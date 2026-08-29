import { Schema } from "effect";

/** A capsule identifier did not satisfy the package's canonical format. */
export class InvalidCapsuleId extends Schema.TaggedError<InvalidCapsuleId>()("InvalidCapsuleId", {
  value: Schema.String,
  reason: Schema.String,
}) {}

/** A derived or explicitly supplied physical namespace is invalid. */
export class InvalidNamespace extends Schema.TaggedError<InvalidNamespace>()("InvalidNamespace", {
  value: Schema.String,
  reason: Schema.String,
}) {}

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

/** An already-known logical migration changed its source checksum. */
export class MigrationChecksumDrift extends Schema.TaggedError<MigrationChecksumDrift>()(
  "MigrationChecksumDrift",
  { migrationId: Schema.Number, expected: Schema.String, actual: Schema.String },
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
}) {}

/** A migration ledger claim conflicted with an incompatible checksum. */
export class LedgerConflict extends Schema.TaggedError<LedgerConflict>()("LedgerConflict", {
  capsuleId: Schema.String,
  migrationId: Schema.Number,
  expected: Schema.String,
  actual: Schema.String,
}) {}

/** A supplied token does not exist or is not valid for this capsule. */
export class TokenNotFound extends Schema.TaggedError<TokenNotFound>()("TokenNotFound", {
  token: Schema.String,
}) {}

/** A token was already consumed and cannot be replayed. */
export class TokenAlreadyConsumed extends Schema.TaggedError<TokenAlreadyConsumed>()(
  "TokenAlreadyConsumed",
  { token: Schema.String, consumedAt: Schema.String },
) {}

/** A supplied token was malformed at the domain boundary. */
export class InvalidToken extends Schema.TaggedError<InvalidToken>()("InvalidToken", {
  reason: Schema.String,
}) {}

/** All predictable failures emitted by CapsuleDB's public runtime seams. */
export type CapsuleError =
  | InvalidCapsuleId
  | InvalidNamespace
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
  | InvalidDefinition
  | PreparationFailed
  | NotReady
  | LedgerConflict
  | TokenNotFound
  | TokenAlreadyConsumed
  | InvalidToken;
