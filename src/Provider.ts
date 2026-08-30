import { Effect, Schema } from "effect";

import { InvalidDefinition, UnsupportedCapability } from "./Error.ts";

/** Canonical provider identity used for exact migration overrides. */
export const Provider = Schema.TaggedUnion({
  BunSqlite: {},
  Libsql: {},
  Postgres: {},
  D1: {},
});

export type Provider = typeof Provider.Type;

/** SQL syntax family shared by SQLite-family providers. */
export const Dialect = Schema.TaggedUnion({
  Sqlite: {},
  Postgres: {},
});

export type Dialect = typeof Dialect.Type;

/** Stable provider implementation keys used by migration maps and manifests. */
export const providerDialectTags = ["BunSqlite", "Libsql", "Postgres", "D1", "Sqlite"] as const;

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

/** A complete provider profile required by registry and manifest validation. */
export const ProviderProfile = Schema.Struct({
  provider: Provider,
  dialect: Dialect,
  execution: Schema.Union([Schema.Literal("Transactional"), Schema.Literal("AtomicBatch")]),
  capabilities: ProviderCapabilities,
});

const ProviderProfileInput = Schema.Struct({
  provider: Schema.optional(Provider),
  dialect: Dialect,
  execution: Schema.optional(
    Schema.Union([Schema.Literal("Transactional"), Schema.Literal("AtomicBatch")]),
  ),
  capabilities: ProviderCapabilities,
});

export type ProviderProfile = typeof ProviderProfile.Type;

export type ProviderProfileError = InvalidDefinition | UnsupportedCapability;

/** The stable textual dialect key used by migration implementation maps. */
export const dialectName = (dialect: Dialect): "sqlite" | "postgres" => {
  switch (dialect._tag) {
    case "Sqlite":
      return "sqlite";
    case "Postgres":
      return "postgres";
  }
};

/** Stable provider identity key used in persistence and migration resolution. */
export const providerName = (provider: Provider): "sqlite" | "libsql" | "postgres" | "d1" => {
  switch (provider._tag) {
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
      try: () => Schema.decodeUnknownSync(ProviderProfileInput)(input),
      catch: (cause) =>
        new InvalidDefinition({
          subject: "provider profile",
          reason: String(cause),
        }),
    });

    const provider =
      profile.provider ??
      (profile.dialect._tag === "Postgres" ? { _tag: "Postgres" } : { _tag: "BunSqlite" });
    const execution = profile.execution ?? profile.capabilities._tag;
    if (provider._tag === "D1" && profile.capabilities._tag !== "AtomicBatch") {
      return yield* Effect.fail(
        new UnsupportedCapability({
          dialect: "d1",
          capability: "interactive transactions, savepoints, streaming, or Effect migrations",
        }),
      );
    }

    if (provider._tag !== "D1" && profile.capabilities._tag === "AtomicBatch") {
      return yield* Effect.fail(
        new UnsupportedCapability({
          dialect: dialectName(profile.dialect),
          capability: "atomic-batch-only execution profile",
        }),
      );
    }

    return { ...profile, provider, execution };
  });

/** The Bun SQLite profile used by the first runtime tracer. */
export const BunSqliteProfile: ProviderProfile = {
  provider: { _tag: "BunSqlite" },
  dialect: { _tag: "Sqlite" },
  execution: "Transactional",
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
  provider: { _tag: "Libsql" },
  dialect: { _tag: "Sqlite" },
  execution: "Transactional",
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
  provider: { _tag: "Postgres" },
  dialect: { _tag: "Postgres" },
  execution: "Transactional",
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
  provider: { _tag: "D1" },
  dialect: { _tag: "Sqlite" },
  execution: "AtomicBatch",
  capabilities: {
    _tag: "AtomicBatch",
    supportsTransactions: false,
    supportsSavepoints: false,
    supportsStreaming: false,
    supportsEffectMigrations: false,
    maxStatements: 2,
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
    provider: profile.provider._tag,
    dialect: profile.dialect._tag,
    execution: profile.execution,
    ...profile.capabilities,
  })),
);
