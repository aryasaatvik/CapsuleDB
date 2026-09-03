import { CapsuleDefinitionError } from "./Error.ts";

/**
 * The column types CapsuleDB renders on every supported dialect.
 *
 * The set is deliberately small. A type earns a place here only when both
 * PostgreSQL and SQLite can store it without the capsule author having to know
 * which engine the host runs.
 */
export type ColumnType = "text" | "integer" | "bigint" | "boolean" | "timestamp" | "json";

/** A raw default expression the author owns, rendered verbatim. */
export interface SqlDefault {
  readonly sql: string;
}

export type ColumnDefault = string | number | boolean | null | SqlDefault;

export interface ColumnOptions {
  readonly nullable?: boolean;
  readonly default?: ColumnDefault;
}

export interface Column extends ColumnOptions {
  readonly type: ColumnType;
}

/**
 * One secondary index over a table's own columns.
 *
 * Parameterized by the column-name union rather than the column map so that a
 * concrete index stays assignable to the erased `Index`.
 */
export interface Index<ColumnName extends string = string> {
  /** Defaults to a deterministic `<table>_<columns>_idx` name. */
  readonly name?: string;
  readonly columns: ReadonlyArray<ColumnName>;
  readonly unique?: boolean;
  /** A partial-index predicate. Author-owned SQL, rendered verbatim. */
  readonly where?: string;
}

/** A named table-level constraint. Author-owned SQL, rendered verbatim. */
export interface Check {
  readonly name: string;
  readonly sql: string;
}

/**
 * One capsule-owned table, declared once and rendered per dialect.
 *
 * `ColumnName` defaults to this table's own column names, which is what gives a
 * declaration its autocomplete. It is a separate parameter so that `keyof
 * Columns` never appears in the interface body: that would make `Table`
 * invariant in `Columns`, and a concrete table would stop being assignable to
 * the erased `Table` that `Capsule.tables` and the renderers hold.
 */
export interface Table<
  Name extends string = string,
  Columns extends Record<string, Column> = Record<string, Column>,
  ColumnName extends string = keyof Columns & string,
> {
  readonly name: Name;
  readonly columns: Columns;
  readonly primaryKey: ReadonlyArray<ColumnName>;
  readonly uniques?: ReadonlyArray<ReadonlyArray<ColumnName>>;
  readonly indexes?: ReadonlyArray<Index<ColumnName>>;
  readonly checks?: ReadonlyArray<Check>;
}

export type Definition<Name extends string, Columns extends Record<string, Column>> = Omit<
  Table<Name, Columns>,
  "name"
>;

type ColumnValue<C extends Column> = C["type"] extends "text"
  ? string
  : C["type"] extends "integer" | "bigint"
    ? number
    : C["type"] extends "boolean"
      ? boolean
      : C["type"] extends "timestamp"
        ? Date
        : unknown;

/** The row type a capsule's own service can use for its declared table. */
export type Row<T extends Table> = {
  readonly [K in keyof T["columns"]]: T["columns"][K] extends { readonly nullable: true }
    ? ColumnValue<T["columns"][K]> | null
    : ColumnValue<T["columns"][K]>;
};

/**
 * SQL identifiers CapsuleDB renders into DDL are restricted to this shape.
 *
 * Author-supplied expressions (`check.sql`, `index.where`, a `{ sql }` default)
 * are rendered verbatim and stay the author's responsibility, but a name that
 * CapsuleDB itself quotes and interpolates must not be able to close the quote.
 */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

const invalid = (subject: string, reason: string): CapsuleDefinitionError =>
  new CapsuleDefinitionError({ subject, reason });

const checkIdentifier = (value: string, subject: string): void => {
  if (!IDENTIFIER.test(value) || value.length > 63) {
    throw invalid(
      subject,
      `${JSON.stringify(value)} is not a valid SQL identifier: use up to 63 letters, digits, and underscores starting with a letter or underscore`,
    );
  }
};

const column =
  <const Type extends ColumnType>(type: Type) =>
  <const Options extends ColumnOptions = Record<never, never>>(
    options?: Options,
  ): { readonly type: Type } & Options =>
    Object.freeze({ ...(options as Options), type });

/** Variable-length text. `TEXT` on both dialects. */
export const text = column("text");
/** A 32-bit integer. `INTEGER` on both dialects. */
export const integer = column("integer");
/** A 64-bit integer. `BIGINT` on PostgreSQL, `INTEGER` on SQLite. */
export const bigint = column("bigint");
/** A boolean. `BOOLEAN` on PostgreSQL, `INTEGER` on SQLite. */
export const boolean = column("boolean");
/** An instant. `TIMESTAMPTZ` on PostgreSQL, `TEXT` on SQLite. */
export const timestamp = column("timestamp");
/** A JSON document. `JSONB` on PostgreSQL, `TEXT` on SQLite. */
export const json = column("json");

/**
 * Declare one table.
 *
 * Pure with `makeUnsafe` semantics, like the other definition constructors: it
 * returns the table and throws {@link CapsuleDefinitionError} on an invalid
 * declaration.
 */
export const table = <const Name extends string, const Columns extends Record<string, Column>>(
  name: Name,
  definition: Definition<Name, Columns>,
): Table<Name, Columns> => {
  checkIdentifier(name, `table ${JSON.stringify(name)}`);

  const columnNames = Object.keys(definition.columns);
  if (columnNames.length === 0) {
    throw invalid(`table ${name}`, "a table must declare at least one column");
  }
  for (const columnName of columnNames) {
    checkIdentifier(columnName, `table ${name} column ${JSON.stringify(columnName)}`);
  }

  const requireDeclared = (candidates: ReadonlyArray<string>, subject: string): void => {
    if (candidates.length === 0) throw invalid(subject, "at least one column is required");
    for (const candidate of candidates) {
      if (!columnNames.includes(candidate)) {
        throw invalid(subject, `${JSON.stringify(candidate)} is not a column of ${name}`);
      }
    }
  };

  requireDeclared([...definition.primaryKey], `table ${name} primary key`);
  for (const unique of definition.uniques ?? []) {
    requireDeclared([...unique], `table ${name} unique constraint`);
  }
  for (const index of definition.indexes ?? []) {
    requireDeclared([...index.columns], `table ${name} index`);
    if (index.name !== undefined) {
      checkIdentifier(index.name, `table ${name} index ${JSON.stringify(index.name)}`);
    }
  }
  for (const check of definition.checks ?? []) {
    checkIdentifier(check.name, `table ${name} check ${JSON.stringify(check.name)}`);
  }

  return Object.freeze({ ...definition, name });
};
