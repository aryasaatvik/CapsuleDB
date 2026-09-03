import { Effect, Schema } from "effect";

import type { Dialect } from "./Dialect.ts";
import { InvalidDefinition, UnsupportedCapability } from "./Error.ts";

/** Canonical provider identity. */
export const Provider = Schema.Union([
  Schema.Literal("BunSqlite"),
  Schema.Literal("Libsql"),
  Schema.Literal("Postgres"),
  Schema.Literal("D1"),
]);

export type Provider = typeof Provider.Type;

const DialectSchema = Schema.Union([Schema.Literal("postgres"), Schema.Literal("sqlite")]);

/** Provider execution capabilities, kept separate from the SQL dialect. */
export const ProviderCapabilities = Schema.TaggedUnion({
  /**
   * A provider that can run ordinary transactional migrations. `streaming`
   * is explicit because Bun SQLite currently has no streaming implementation
   * even though its migration execution is transactional.
   */
  Transactional: {
    supportsTransactions: Schema.Literal(true),
    supportsSavepoints: Schema.Literal(true),
    supportsStreaming: Schema.Boolean,
    supportsEffectMigrations: Schema.Literal(true),
  },
  /**
   * D1's bounded `batch` primitive is atomic but is not an interactive
   * transaction, savepoint, stream, or arbitrary Effect-migration capability.
   */
  AtomicBatch: {
    supportsTransactions: Schema.Literal(false),
    supportsSavepoints: Schema.Literal(false),
    supportsStreaming: Schema.Literal(false),
    supportsEffectMigrations: Schema.Literal(false),
    maxStatements: Schema.Int.check(Schema.isGreaterThan(0)),
    maxSqlStatementBytes: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    maxBoundParameters: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  },
});

export type ProviderCapabilities = typeof ProviderCapabilities.Type;

/**
 * A complete provider profile required by registry and manifest validation.
 *
 * `capabilities._tag` is the execution model; there is no second field
 * restating it.
 */
export const ProviderProfile = Schema.Struct({
  provider: Provider,
  dialect: DialectSchema,
  capabilities: ProviderCapabilities,
});

export type ProviderProfile = typeof ProviderProfile.Type;

export type ProviderProfileError = InvalidDefinition | UnsupportedCapability;

/** The dialect each provider speaks. */
export const providerDialect = (provider: Provider): Dialect =>
  provider === "Postgres" ? "postgres" : "sqlite";

/** Stable provider identity key used in persistence and ledger stamping. */
export const providerName = (provider: Provider): "sqlite" | "libsql" | "postgres" | "d1" => {
  switch (provider) {
    case "BunSqlite":
      return "sqlite";
    case "Libsql":
      return "libsql";
    case "Postgres":
      return "postgres";
    case "D1":
      return "d1";
  }
};

/**
 * Parse and validate a provider profile at the composition boundary.
 *
 * D1 is deliberately restricted to the atomic-batch capability. This keeps
 * unsupported interactive transactions, savepoints, streams, and dynamic
 * Effect migrations from being smuggled in through a structural object.
 */
export const makeProviderProfile = (
  input: unknown,
): Effect.Effect<ProviderProfile, ProviderProfileError> =>
  Effect.gen(function* () {
    const profile = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(ProviderProfile)(input),
      catch: (cause) =>
        new InvalidDefinition({
          subject: "provider profile",
          reason: String(cause),
        }),
    });

    const expectedDialect = providerDialect(profile.provider);
    if (profile.dialect !== expectedDialect) {
      return yield* Effect.fail(
        new InvalidDefinition({
          subject: "provider profile",
          reason: `${profile.provider} requires the ${expectedDialect} SQL dialect`,
        }),
      );
    }
    if (profile.provider === "D1" && profile.capabilities._tag !== "AtomicBatch") {
      return yield* Effect.fail(
        new UnsupportedCapability({
          dialect: "d1",
          capability: "interactive transactions, savepoints, streaming, or Effect migrations",
        }),
      );
    }
    if (profile.provider !== "D1" && profile.capabilities._tag === "AtomicBatch") {
      return yield* Effect.fail(
        new UnsupportedCapability({
          dialect: profile.dialect,
          capability: "atomic-batch-only execution profile",
        }),
      );
    }

    return profile;
  });

/** The Bun SQLite profile used by the first runtime tracer. */
export const BunSqliteProfile: ProviderProfile = {
  provider: "BunSqlite",
  dialect: "sqlite",
  capabilities: {
    _tag: "Transactional",
    supportsTransactions: true,
    supportsSavepoints: true,
    supportsStreaming: false,
    supportsEffectMigrations: true,
  },
};

/** A libSQL profile over a host-provided libSQL client. */
export const LibsqlProfile: ProviderProfile = {
  provider: "Libsql",
  dialect: "sqlite",
  capabilities: {
    _tag: "Transactional",
    supportsTransactions: true,
    supportsSavepoints: true,
    supportsStreaming: false,
    supportsEffectMigrations: true,
  },
};

/** A PostgreSQL profile for shared logical migration histories. */
export const PostgresProfile: ProviderProfile = {
  provider: "Postgres",
  dialect: "postgres",
  capabilities: {
    _tag: "Transactional",
    supportsTransactions: true,
    supportsSavepoints: true,
    supportsStreaming: true,
    supportsEffectMigrations: true,
  },
};

/** The bounded static-batch profile established by the D1 research probe. */
export const D1Profile: ProviderProfile = {
  provider: "D1",
  dialect: "sqlite",
  capabilities: {
    _tag: "AtomicBatch",
    supportsTransactions: false,
    supportsSavepoints: false,
    supportsStreaming: false,
    supportsEffectMigrations: false,
    // Cloudflare documents per-statement limits for `db.batch` but no batch
    // statement count, so this is CapsuleDB's own bound rather than an invented
    // provider maximum. It leaves room for the ledger claim plus a declared
    // table and its indexes in one atomic batch.
    maxStatements: 16,
    maxSqlStatementBytes: 100_000,
    maxBoundParameters: 100,
  },
};

/** The profiles used by the provider conformance matrix. */
export const providerProfiles = Object.freeze([
  BunSqliteProfile,
  LibsqlProfile,
  PostgresProfile,
  D1Profile,
] as const);

/**
 * A machine-readable view of the canonical provider capabilities. The report
 * is derived from the profiles above so tests and documentation cannot drift
 * from the runtime validation model.
 */
export const providerCapabilityMatrix = Object.freeze(
  providerProfiles.map((profile) => ({
    provider: profile.provider,
    dialect: profile.dialect,
    ...profile.capabilities,
  })),
);
