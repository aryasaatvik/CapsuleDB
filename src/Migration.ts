import type * as Effect from "effect/Effect";
import { Schema as EffectSchema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { type Dialect, dialects, render, supports } from "./Dialect.ts";
import { CapsuleDefinitionError } from "./Error.ts";
import type { Column, Index, Table } from "./Schema.ts";

/** A positive logical migration number shared by every dialect. */
export const MigrationId = EffectSchema.Int.pipe(
  EffectSchema.check(EffectSchema.isGreaterThan(0)),
  EffectSchema.brand("MigrationId"),
);

export type MigrationId = typeof MigrationId.Type;

/** A stable migration name used for append-only history validation. */
export const MigrationName = EffectSchema.String.pipe(
  EffectSchema.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(128),
    EffectSchema.isPattern(/^[a-z][a-z0-9._-]*$/),
  ),
  EffectSchema.brand("MigrationName"),
);

export type MigrationName = typeof MigrationName.Type;

/** Immutable author revision for an Effect migration step. */
export const MigrationRevision = EffectSchema.String.pipe(
  EffectSchema.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(256)),
  EffectSchema.brand("MigrationRevision"),
);

export type MigrationRevision = typeof MigrationRevision.Type;

/** Operational risk declared by a migration author. */
export const MigrationRisk = EffectSchema.Union([
  EffectSchema.Literal("additive"),
  EffectSchema.Literal("destructive"),
]);

export type MigrationRisk = typeof MigrationRisk.Type;

/**
 * One step of a migration.
 *
 * Declarative steps render on every dialect from one declaration. `Sql` is the
 * escape hatch for engine-specific statements, and `Effect` is for work that
 * needs the host client. A migration may mix all three.
 */
export type Step<Failure = unknown> =
  | { readonly _tag: "CreateTable"; readonly table: Table }
  | {
      readonly _tag: "AddColumn";
      readonly table: string;
      readonly column: string;
      readonly definition: Column;
    }
  | { readonly _tag: "CreateIndex"; readonly table: string; readonly index: Index }
  | { readonly _tag: "DropTable"; readonly table: string }
  | { readonly _tag: "Sql"; readonly bodies: Partial<Record<Dialect, ReadonlyArray<string>>> }
  | {
      readonly _tag: "Effect";
      /** Immutable author-assigned revision; function bodies are opaque. */
      readonly revision: string;
      /**
       * Effect steps may use the host SQL client only. Keeping this environment
       * exact lets preparation provide the same client and transaction without
       * erasing a missing-service defect behind the migration boundary.
       */
      readonly execute: Effect.Effect<void, Failure, SqlClient.SqlClient>;
    };

/** One logical migration entry shared across dialects. */
export interface Migration<Failure = unknown> {
  readonly id: MigrationId;
  readonly name: MigrationName;
  readonly risk: MigrationRisk;
  readonly steps: ReadonlyArray<Step<Failure>>;
}

export interface Options<Failure = unknown> {
  readonly id: number;
  readonly name: string;
  readonly risk: MigrationRisk;
  readonly steps: ReadonlyArray<Step<Failure>>;
}

/**
 * One unit of applied work for a single dialect.
 *
 * Resolution coalesces adjacent SQL-producing steps into one operation, so a
 * migration made only of declarative steps is a single statement list.
 */
export type Operation<Failure = unknown> =
  | { readonly _tag: "Sql"; readonly statements: ReadonlyArray<string> }
  | {
      readonly _tag: "Effect";
      readonly revision: string;
      readonly execute: Effect.Effect<void, Failure, SqlClient.SqlClient>;
    };

/** Declare a table in one step; renders `CREATE TABLE` plus its indexes. */
export const createTable = (table: Table): Step<never> => ({ _tag: "CreateTable", table });

/** Add one column to an existing table. */
export const addColumn = (table: string, column: string, definition: Column): Step<never> => ({
  _tag: "AddColumn",
  table,
  column,
  definition,
});

/** Create one secondary index over an existing table. */
export const createIndex = (table: string, index: Index): Step<never> => ({
  _tag: "CreateIndex",
  table,
  index,
});

/** Drop a table. Only valid inside a migration marked `destructive`. */
export const dropTable = (table: string): Step<never> => ({ _tag: "DropTable", table });

/** Raw statements for the dialects that need engine-specific SQL. */
export const sql = (bodies: Partial<Record<Dialect, ReadonlyArray<string>>>): Step<never> => ({
  _tag: "Sql",
  bodies,
});

/** Run an Effect against the host SQL client inside the migration. */
export const effect = <Failure>(
  revision: string,
  execute: Effect.Effect<void, Failure, SqlClient.SqlClient>,
): Step<Failure> => ({ _tag: "Effect", revision, execute });

const decodeOrThrow = <A>(
  schema: EffectSchema.ConstraintDecoder<A, never>,
  input: unknown,
  subject: string,
): A => {
  try {
    return EffectSchema.decodeUnknownSync(schema)(input);
  } catch (cause) {
    throw new CapsuleDefinitionError({ subject, reason: String(cause) });
  }
};

/**
 * Construct a validated logical migration at an authoring boundary.
 *
 * Pure with `makeUnsafe` semantics: it returns the migration and throws
 * {@link CapsuleDefinitionError} on an invalid definition, so a migration list
 * is a module-level constant.
 */
export const make = <Failure = unknown>(options: Options<Failure>): Migration<Failure> => {
  const subject = `migration ${String(options.id)}`;
  const id = decodeOrThrow(MigrationId, options.id, `${subject} id`);
  const name = decodeOrThrow(MigrationName, options.name, `${subject} name`);
  const risk = decodeOrThrow(MigrationRisk, options.risk, `${subject} risk`);

  if (options.steps.length === 0) {
    throw new CapsuleDefinitionError({ subject, reason: "at least one step is required" });
  }
  for (const step of options.steps) {
    if (step._tag === "Effect") {
      decodeOrThrow(MigrationRevision, step.revision, `${subject} step revision`);
    }
    if (step._tag === "Sql") {
      const bodies = Object.entries(step.bodies);
      if (bodies.length === 0) {
        throw new CapsuleDefinitionError({
          subject: `${subject} raw SQL step`,
          reason: "at least one dialect body is required",
        });
      }
      for (const [dialect, statements] of bodies) {
        if (statements === undefined || statements.length === 0) {
          throw new CapsuleDefinitionError({
            subject: `${subject} ${dialect} body`,
            reason: "SQL statements must not be empty",
          });
        }
      }
    }
  }

  const migration = Object.freeze({ id, name, risk, steps: Object.freeze([...options.steps]) });
  if (supportedDialects(migration).length === 0) {
    throw new CapsuleDefinitionError({
      subject,
      reason: "no dialect can apply every step of this migration",
    });
  }
  return migration;
};

/** The dialects that can apply every step of a migration. */
export const supportedDialects = <Failure>(
  migration: Pick<Migration<Failure>, "steps">,
): ReadonlyArray<Dialect> =>
  dialects.filter((dialect) => migration.steps.every((step) => supports(step, dialect)));

/**
 * Resolve a migration into the ordered work one dialect applies, or
 * `undefined` when a step has no body for that dialect.
 */
export const resolve = <Failure>(
  migration: Pick<Migration<Failure>, "steps">,
  dialect: Dialect,
): ReadonlyArray<Operation<Failure>> | undefined => {
  if (!migration.steps.every((step) => supports(step, dialect))) return undefined;

  const operations: Array<Operation<Failure>> = [];
  let statements: Array<string> = [];
  const flush = () => {
    if (statements.length > 0) {
      operations.push({ _tag: "Sql", statements: Object.freeze(statements) });
      statements = [];
    }
  };

  for (const step of migration.steps) {
    if (step._tag === "Effect") {
      flush();
      operations.push({ _tag: "Effect", revision: step.revision, execute: step.execute });
      continue;
    }
    statements.push(...render(step, dialect));
  }
  flush();
  return Object.freeze(operations);
};

/** Every table a migration creates, in declaration order. */
export const createdTables = <Failure>(
  migration: Pick<Migration<Failure>, "steps">,
): ReadonlyArray<Table> =>
  migration.steps.flatMap((step) => (step._tag === "CreateTable" ? [step.table] : []));
