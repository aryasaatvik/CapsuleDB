import { Effect, Schema } from "effect";

import { InvalidDefinition, UnsupportedCapability } from "./Error.ts";

/** The SQL dialect is intentionally independent from execution capabilities. */
export const ProviderDialect = Schema.TaggedUnion({
  Sqlite: {},
  Postgres: {},
  D1: {},
});

export type ProviderDialect = typeof ProviderDialect.Type;

/** Stable runtime keys used by provider implementation maps and manifests. */
export const providerDialectTags = ["Sqlite", "Postgres", "D1"] as const;

/**
 * A provider that can run ordinary transactional migrations.
 *
 * `streaming` is explicit because Bun SQLite currently has no streaming
 * implementation even though its migration execution is transactional.
 */
const TransactionalCapabilities = Schema.TaggedStruct("Transactional", {
  supportsTransactions: Schema.Literal(true),
  supportsSavepoints: Schema.Literal(true),
  supportsStreaming: Schema.Boolean,
  supportsEffectMigrations: Schema.Literal(true),
});

/**
 * D1's bounded `batch` primitive is atomic but is not an interactive
 * transaction, savepoint, stream, or arbitrary Effect-migration capability.
 */
const AtomicBatchCapabilities = Schema.TaggedStruct("AtomicBatch", {
  supportsTransactions: Schema.Literal(false),
  supportsSavepoints: Schema.Literal(false),
  supportsStreaming: Schema.Literal(false),
  supportsEffectMigrations: Schema.Literal(false),
  maxStatements: Schema.Int.check(Schema.isGreaterThan(0)),
});

/** Provider execution capabilities, kept separate from the SQL dialect. */
export const ProviderCapabilities = Schema.Union([
  TransactionalCapabilities,
  AtomicBatchCapabilities,
]);

export type ProviderCapabilities = typeof ProviderCapabilities.Type;

/** A complete provider profile required by registry and manifest validation. */
export const ProviderProfile = Schema.Struct({
  dialect: ProviderDialect,
  capabilities: ProviderCapabilities,
});

export type ProviderProfile = typeof ProviderProfile.Type;

export type ProviderProfileError = InvalidDefinition | UnsupportedCapability;

/** The stable textual dialect key used by migration implementation maps. */
export const providerDialectName = (dialect: ProviderDialect): "sqlite" | "postgres" | "d1" => {
  switch (dialect._tag) {
    case "Sqlite":
      return "sqlite";
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

    if (profile.dialect._tag === "D1" && profile.capabilities._tag !== "AtomicBatch") {
      return yield* Effect.fail(
        new UnsupportedCapability({
          dialect: "d1",
          capability: "interactive transactions, savepoints, streaming, or Effect migrations",
        }),
      );
    }

    if (profile.dialect._tag !== "D1" && profile.capabilities._tag === "AtomicBatch") {
      return yield* Effect.fail(
        new UnsupportedCapability({
          dialect: providerDialectName(profile.dialect),
          capability: "atomic-batch-only execution profile",
        }),
      );
    }

    return profile;
  });

/** The Bun SQLite profile used by the first runtime tracer. */
export const BunSqliteProfile: ProviderProfile = {
  dialect: { _tag: "Sqlite" },
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
  dialect: { _tag: "Postgres" },
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
  dialect: { _tag: "D1" },
  capabilities: {
    _tag: "AtomicBatch",
    supportsTransactions: false,
    supportsSavepoints: false,
    supportsStreaming: false,
    supportsEffectMigrations: false,
    maxStatements: 2,
  },
};
