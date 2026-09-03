import type * as Effect from "effect/Effect";
import { Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { CapsuleDefinitionError } from "./Error.ts";
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

export interface Options<Failure = unknown> {
  readonly id: number;
  readonly name: string;
  readonly risk: MigrationRisk;
  readonly providers: MigrationImplementations<Failure>;
}

const decodeOrThrow = <A>(
  schema: Schema.ConstraintDecoder<A, never>,
  input: unknown,
  subject: string,
): A => {
  try {
    return Schema.decodeUnknownSync(schema)(input);
  } catch (cause) {
    throw new CapsuleDefinitionError({ subject, reason: String(cause) });
  }
};

/**
 * Construct a validated logical migration at an authoring boundary.
 *
 * Like {@link Capsule.make} this constructor is pure with `makeUnsafe`
 * semantics: it returns the migration and throws {@link CapsuleDefinitionError}
 * on an invalid definition, so a migration list is a module-level constant.
 */
export const make = <Failure = unknown>(options: Options<Failure>): Migration<Failure> => {
  const id = decodeOrThrow(MigrationId, options.id, `migration ${String(options.id)} id`);
  const name = decodeOrThrow(MigrationName, options.name, `migration ${String(options.id)} name`);
  const risk = decodeOrThrow(MigrationRisk, options.risk, `migration ${String(options.id)} risk`);

  const providers = Object.entries(options.providers);
  if (providers.length === 0) {
    throw new CapsuleDefinitionError({
      subject: `migration ${String(options.id)}`,
      reason: "at least one provider implementation is required",
    });
  }
  for (const [provider, body] of providers) {
    if (body._tag === "Effect") {
      decodeOrThrow(
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
};

/** Construct a static SQL body without introducing a query-builder API. */
export const sqlBody = (statements: ReadonlyArray<string>): SqlMigrationBody =>
  Object.freeze({
    _tag: "Sql" as const,
    statements: Object.freeze([...statements]),
  });

/** Construct an Effect body while retaining its typed error and environment. */
export const effectBody = <Failure>(
  revision: string,
  execute: Effect.Effect<void, Failure, SqlClient.SqlClient>,
): EffectMigrationBody<Failure> =>
  Object.freeze({
    _tag: "Effect" as const,
    revision,
    execute,
  });
