import { Schema } from "effect";

/** One migration the registry has not yet observed in the host's ledger. */
export const PendingMigration = Schema.Struct({
  capsule: Schema.String,
  migration: Schema.Int,
  name: Schema.String,
});

export type PendingMigration = typeof PendingMigration.Type;

/**
 * The single readiness model for a registry against one host database.
 *
 * `prepare`, `status`, and the readiness assertion all answer with this union;
 * there is no separate plan state or receipt type.
 */
export const Readiness = Schema.TaggedUnion({
  /** Every registered migration is applied and the fingerprint agrees. */
  Ready: {
    fingerprint: Schema.String,
    provider: Schema.String,
    capsules: Schema.Int,
  },
  /** The registry is behind the code; these migrations still have to run. */
  Pending: {
    fingerprint: Schema.String,
    pending: Schema.Array(PendingMigration),
  },
  /**
   * The database disagrees with the code in a way preparation cannot repair:
   * a checksum conflict, a provider switch, a newer database, or corruption.
   */
  Drift: {
    fingerprint: Schema.String,
    reason: Schema.String,
  },
});

export type Readiness = typeof Readiness.Type;

/** The successful readiness state a prepared registry reports. */
export type Ready = Extract<Readiness, { readonly _tag: "Ready" }>;
