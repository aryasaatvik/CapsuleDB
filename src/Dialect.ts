import { CapsuleDefinitionError } from "./Error.ts";
import type { Step } from "./Migration.ts";
import { indexName, type Column, type ColumnDefault, type Index, type Table } from "./Schema.ts";

/**
 * The SQL syntax families CapsuleDB renders.
 *
 * `sqlite` covers every SQLite-family provider — Bun SQLite, libSQL, and
 * Cloudflare D1 — because they share the syntax CapsuleDB emits.
 */
export type Dialect = "postgres" | "sqlite";

/** Every dialect, in the order renderers and manifests iterate them. */
export const dialects = ["postgres", "sqlite"] as const;

const COLUMN_TYPES = {
  postgres: {
    text: "TEXT",
    integer: "INTEGER",
    bigint: "BIGINT",
    boolean: "BOOLEAN",
    timestamp: "TIMESTAMPTZ",
    json: "JSONB",
  },
  sqlite: {
    text: "TEXT",
    integer: "INTEGER",
    bigint: "INTEGER",
    boolean: "INTEGER",
    timestamp: "TEXT",
    json: "TEXT",
  },
} as const;

const quote = (identifier: string): string => `"${identifier}"`;

const quoteAll = (identifiers: ReadonlyArray<string>): string => identifiers.map(quote).join(", ");

const literal = (value: ColumnDefault, dialect: Dialect): string => {
  if (value === null) return "NULL";
  if (typeof value === "object") return value.sql;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") {
    return dialect === "postgres" ? (value ? "TRUE" : "FALSE") : value ? "1" : "0";
  }
  return `'${value.replaceAll("'", "''")}'`;
};

const columnClause = (name: string, column: Column, dialect: Dialect): string => {
  const parts = [quote(name), COLUMN_TYPES[dialect][column.type]];
  if (column.nullable !== true) parts.push("NOT NULL");
  if (column.default !== undefined) parts.push(`DEFAULT ${literal(column.default, dialect)}`);
  return parts.join(" ");
};

/** Render one `CREATE INDEX` statement for a declared index. */
export const renderIndex = (table: string, index: Index, dialect: Dialect): string => {
  const unique = index.unique === true ? "UNIQUE " : "";
  const where = index.where === undefined ? "" : ` WHERE ${index.where}`;
  return `CREATE ${unique}INDEX ${quote(indexName(table, index))} ON ${quote(table)} (${quoteAll(index.columns)})${where}`;
};

/**
 * Render a declared table as `CREATE TABLE` plus one statement per index.
 *
 * The output is deterministic: columns keep declaration order, then the primary
 * key, then unique constraints, then checks, then indexes in declared order.
 */
export const renderTable = (table: Table, dialect: Dialect): ReadonlyArray<string> => {
  const clauses = Object.entries(table.columns).map(([name, column]) =>
    columnClause(name, column, dialect),
  );
  clauses.push(`PRIMARY KEY (${quoteAll(table.primaryKey)})`);
  for (const unique of table.uniques ?? []) clauses.push(`UNIQUE (${quoteAll(unique)})`);
  for (const check of table.checks ?? []) {
    clauses.push(`CONSTRAINT ${quote(check.name)} CHECK (${check.sql})`);
  }

  return [
    `CREATE TABLE ${quote(table.name)} (\n  ${clauses.join(",\n  ")}\n)`,
    ...(table.indexes ?? []).map((index) => renderIndex(table.name, index, dialect)),
  ];
};

/** Whether a migration step has a body this dialect can apply. */
export const supports = (step: Step, dialect: Dialect): boolean =>
  step._tag === "Sql" ? step.bodies[dialect] !== undefined : true;

/**
 * Render one migration step as ordered SQL statements.
 *
 * Throws {@link CapsuleDefinitionError} for an `Effect` step, which has no SQL
 * form, and for a `Sql` step with no body for this dialect. Use
 * {@link supports} to decide first.
 */
export const render = (step: Step, dialect: Dialect): ReadonlyArray<string> => {
  switch (step._tag) {
    case "CreateTable":
      return renderTable(step.table, dialect);
    case "AddColumn":
      return [
        `ALTER TABLE ${quote(step.table)} ADD COLUMN ${columnClause(step.column, step.definition, dialect)}`,
      ];
    case "CreateIndex":
      return [renderIndex(step.table, step.index, dialect)];
    case "DropTable":
      return [`DROP TABLE ${quote(step.table)}`];
    case "Sql": {
      const body = step.bodies[dialect];
      if (body === undefined) {
        throw new CapsuleDefinitionError({
          subject: "migration step",
          reason: `a raw SQL step has no ${dialect} body`,
        });
      }
      return body;
    }
    case "Effect":
      throw new CapsuleDefinitionError({
        subject: `migration step ${step.revision}`,
        reason: "an Effect step is executable, not renderable SQL",
      });
  }
};
