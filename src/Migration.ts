import { Effect, Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { InvalidDefinition } from "./Error.ts";
import type { Dialect, Provider } from "./Provider.ts";
import type { ProviderProfile } from "./Provider.ts";

/** A positive logical migration number shared by every provider. */
export const MigrationId = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("MigrationId"),
);

export type MigrationId = typeof MigrationId.Type;

/** A stable migration name used for append-only history validation. */
export const MigrationName = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(/^[a-z][a-z0-9._-]*$/),
  ),
  Schema.brand("MigrationName"),
);

export type MigrationName = typeof MigrationName.Type;

/** Immutable author revision for an Effect migration body. */
export const MigrationRevision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  Schema.brand("MigrationRevision"),
);

export type MigrationRevision = typeof MigrationRevision.Type;

/** Operational risk declared by a migration author. */
export const MigrationRisk = Schema.Union([
  Schema.Literal("additive"),
  Schema.Literal("destructive"),
]);

export type MigrationRisk = typeof MigrationRisk.Type;

/** A static SQL migration body. Canonical statements are the integrity input. */
export interface SqlMigrationBody {
  readonly _tag: "Sql";
  readonly statements: ReadonlyArray<string>;
}

/** An Effect migration body for providers that explicitly support it. */
export interface EffectMigrationBody<Failure = unknown> {
  readonly _tag: "Effect";
  /** Immutable author-assigned revision; function bodies are intentionally opaque. */
  readonly revision: string;
  /**
   * Effect migrations may use the host SQL client only. Keeping this
   * environment exact lets preparation provide the same client transaction
   * without erasing missing-service defects behind the migration boundary.
   */
  readonly execute: Effect.Effect<void, Failure, SqlClient.SqlClient>;
}

export type MigrationBody<Failure = unknown> = SqlMigrationBody | EffectMigrationBody<Failure>;

/**
 * Schema-visible migration mode metadata. Function bodies remain runtime
 * values and are never serialized into a manifest.
 */
export const MigrationMode = Schema.TaggedUnion({
  Sql: {
    statements: Schema.Array(Schema.String),
  },
  Effect: {
    revision: MigrationRevision,
    execute: Schema.Unknown,
  },
});

export type MigrationMode = typeof MigrationMode.Type;

export type MigrationProviderKey = Provider["_tag"] | Dialect["_tag"];

/** Provider-specific implementations for one logical migration. */
export type MigrationImplementations<Failure = unknown> = Readonly<
  Partial<Record<MigrationProviderKey, MigrationBody<Failure>>>
>;

/** Resolve an exact provider override before the shared SQL dialect default. */
export const resolveMigrationImplementation = <Failure = unknown>(
  migration: Pick<Migration<Failure>, "providers">,
  provider: ProviderProfile,
): MigrationBody<Failure> | undefined => {
  return migration.providers[provider.provider._tag] ?? migration.providers[provider.dialect._tag];
};

/** One logical migration history entry shared across provider implementations. */
export interface Migration<Failure = unknown> {
  readonly id: MigrationId;
  readonly name: MigrationName;
  readonly risk: MigrationRisk;
  readonly providers: MigrationImplementations<Failure>;
}

export interface MigrationOptions<Failure = unknown> {
  readonly id: unknown;
  readonly name: unknown;
  readonly risk: unknown;
  readonly providers: MigrationImplementations<Failure>;
}

export type MigrationDefinitionError = InvalidDefinition;

/** Construct a validated logical migration at an authoring boundary. */
export const makeMigration = <Failure = unknown>(
  options: MigrationOptions<Failure>,
): Effect.Effect<Migration<Failure>, MigrationDefinitionError> =>
  Effect.gen(function* () {
    const decode = <A>(
      schema: Schema.ConstraintDecoder<A, never>,
      input: unknown,
      subject: string,
    ) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(input),
        catch: (cause) => new InvalidDefinition({ subject, reason: String(cause) }),
      });

    const id = yield* decode(MigrationId, options.id, "migration id");
    const name = yield* decode(MigrationName, options.name, "migration name");
    const risk = yield* decode(MigrationRisk, options.risk, "migration risk");

    if (Object.keys(options.providers).length === 0) {
      return yield* Effect.fail(
        new InvalidDefinition({
          subject: `migration ${String(options.id)}`,
          reason: "at least one provider implementation is required",
        }),
      );
    }

    for (const [provider, body] of Object.entries(options.providers)) {
      if (body._tag === "Effect") {
        yield* decode(
          MigrationRevision,
          body.revision,
          `migration ${String(options.id)} ${provider} revision`,
        );
      }
    }

    return Object.freeze({
      id,
      name,
      risk,
      providers: Object.freeze({ ...options.providers }),
    });
  });

/** Construct a static SQL body without introducing a query-builder API. */
export const sqlMigrationBody = (statements: ReadonlyArray<string>): SqlMigrationBody =>
  Object.freeze({
    _tag: "Sql" as const,
    statements: Object.freeze([...statements]),
  });

/** Construct an Effect body while retaining its typed error and environment. */
export const effectMigrationBody = <Failure>(
  revision: string,
  execute: Effect.Effect<void, Failure, SqlClient.SqlClient>,
): EffectMigrationBody<Failure> =>
  Object.freeze({
    _tag: "Effect" as const,
    revision,
    execute,
  });
