import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type * as Statement from "effect/unstable/sql/Statement";

import { InvalidDefinition, ProviderMismatch } from "../Error.ts";
import type { MigrationBody } from "../Migration.ts";
import type { ProviderProfile } from "../Provider.ts";
import { LEDGER_TABLE } from "./transactional-migrator.ts";

/** The narrow D1 runtime capability consumed by CapsuleDB. */
export interface D1BatchClient extends SqlClient.SqlClient {
  readonly batch: <const Statements extends ReadonlyArray<Statement.Statement<unknown>>>(
    statements: Statements,
  ) => Effect.Effect<unknown, SqlError>;
}

export interface D1Migration {
  readonly sql: D1BatchClient;
  readonly profile: ProviderProfile;
  readonly capsuleId: string;
  readonly migrationId: number;
  readonly name: string;
  readonly checksum: string;
  readonly body: MigrationBody;
}

const isBatchClient = (sql: SqlClient.SqlClient): sql is D1BatchClient =>
  typeof (sql as unknown as Partial<D1BatchClient>).batch === "function";

const invalidMigration = (options: D1Migration, reason: string): InvalidDefinition =>
  new InvalidDefinition({
    subject: `migration ${options.capsuleId}/${options.migrationId}`,
    reason,
  });

/**
 * Build and validate one complete D1 batch without invoking the provider.
 * Registry preparation uses this for an all-pending preflight so a later
 * invalid migration cannot follow an earlier mutation.
 */
export const compileD1Migration = (
  options: D1Migration,
): Effect.Effect<
  ReadonlyArray<Statement.Statement<unknown>>,
  InvalidDefinition | ProviderMismatch
> =>
  Effect.gen(function* () {
    if (!isBatchClient(options.sql)) {
      return yield* Effect.fail(
        new ProviderMismatch({ dialect: "d1", mode: "missing atomic batch client" }),
      );
    }
    if (options.body._tag !== "Sql") {
      return yield* Effect.fail(new ProviderMismatch({ dialect: "d1", mode: options.body._tag }));
    }

    const capabilities = options.profile.capabilities;
    if (capabilities._tag !== "AtomicBatch") {
      return yield* Effect.fail(new ProviderMismatch({ dialect: "d1", mode: capabilities._tag }));
    }

    const statements: Array<Statement.Statement<unknown>> = [
      options.sql`INSERT INTO ${options.sql(LEDGER_TABLE)}
        (capsule_id, migration_id, name, checksum, applied_at)
        VALUES (${options.capsuleId}, ${options.migrationId}, ${options.name},
          ${options.checksum}, ${new Date().toISOString()})`,
      ...options.body.statements.map((statement) => options.sql.unsafe(statement)),
    ];

    if (statements.length > capabilities.maxStatements) {
      return yield* Effect.fail(
        invalidMigration(
          options,
          `D1 atomic batch has ${statements.length} statements; maximum is ${capabilities.maxStatements}`,
        ),
      );
    }

    for (const statement of statements) {
      const [source, parameters] = statement.compile();
      const sqlBytes = new TextEncoder().encode(source).byteLength;
      if (
        capabilities.maxSqlStatementBytes !== undefined &&
        sqlBytes > capabilities.maxSqlStatementBytes
      ) {
        return yield* Effect.fail(
          invalidMigration(
            options,
            `D1 SQL statement is ${sqlBytes} bytes; maximum is ${capabilities.maxSqlStatementBytes}`,
          ),
        );
      }
      if (
        capabilities.maxBoundParameters !== undefined &&
        parameters.length > capabilities.maxBoundParameters
      ) {
        return yield* Effect.fail(
          invalidMigration(
            options,
            `D1 SQL statement has ${parameters.length} bound parameters; maximum is ${capabilities.maxBoundParameters}`,
          ),
        );
      }
    }

    return statements;
  });

/**
 * Compile and execute one D1 migration as a single claim-first batch.
 *
 * Every limit is checked before invoking `batch`, and this function never
 * calls `withTransaction`: D1's batch is atomic but has no interactive
 * transaction or savepoint semantics.
 */
export const runD1Migration = (
  options: D1Migration,
): Effect.Effect<void, SqlError | InvalidDefinition | ProviderMismatch> =>
  Effect.gen(function* () {
    const statements = yield* compileD1Migration(options);
    if (!isBatchClient(options.sql)) {
      return yield* Effect.fail(
        new ProviderMismatch({ dialect: "d1", mode: "missing atomic batch client" }),
      );
    }
    yield* options.sql.batch(statements);
  });
