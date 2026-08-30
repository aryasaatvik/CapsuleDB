import { Effect, Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { InvalidDefinition } from "./Error.ts";
import type { ProviderDialect } from "./Provider.ts";

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

/** Operational risk declared by a migration author. */
export const MigrationRisk = Schema.Union([
  Schema.Literal("additive"),
  Schema.Literal("destructive"),
]);

export type MigrationRisk = typeof MigrationRisk.Type;

/** A static SQL migration body. `source` is authored source text, never a function serialization. */
export interface SqlMigrationBody {
  readonly _tag: "Sql";
  readonly source: string;
  readonly statements: ReadonlyArray<string>;
}

/** An Effect migration body for providers that explicitly support it. */
export interface EffectMigrationBody<Failure = unknown> {
  readonly _tag: "Effect";
  readonly source: string;
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
    source: Schema.String,
    statements: Schema.Array(Schema.String),
  },
  Effect: {
    source: Schema.String,
    execute: Schema.Unknown,
  },
});

export type MigrationMode = typeof MigrationMode.Type;

export type ProviderDialectTag = ProviderDialect["_tag"];

/** Provider-specific implementations for one logical migration. */
export type MigrationImplementations<Failure = unknown> = Readonly<
  Partial<Record<ProviderDialectTag, MigrationBody<Failure>>>
>;

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

    return Object.freeze({
      id,
      name,
      risk,
      providers: Object.freeze({ ...options.providers }),
    });
  });

/** Construct a static SQL body without introducing a query-builder API. */
export const sqlMigrationBody = (
  source: string,
  statements: ReadonlyArray<string>,
): SqlMigrationBody =>
  Object.freeze({
    _tag: "Sql" as const,
    source,
    statements: Object.freeze([...statements]),
  });

/** Construct an Effect body while retaining its typed error and environment. */
export const effectMigrationBody = <Failure>(
  source: string,
  execute: Effect.Effect<void, Failure, SqlClient.SqlClient>,
): EffectMigrationBody<Failure> =>
  Object.freeze({
    _tag: "Effect" as const,
    source,
    execute,
  });
