import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { InvalidDefinition, PreparationFailed, ProviderMismatch } from "../Error.ts";
import type { Operation } from "../Migration.ts";

/** The default prefix for the tables CapsuleDB's lifecycle owns. */
export const DEFAULT_PREFIX = "capsuledb";

const PREFIX = /^[a-z_][a-z0-9_]{0,32}$/;

/**
 * The private table names one registry owns.
 *
 * A prefix lets two independent registries share a database. It is part of the
 * physical layout, so it must not change after the first deployment.
 */
export const ledgerTables = (
  prefix: string = DEFAULT_PREFIX,
): { readonly ledger: string; readonly metadata: string } => {
  if (!PREFIX.test(prefix)) {
    throw new InvalidDefinition({
      subject: `registry prefix ${JSON.stringify(prefix)}`,
      reason: "a prefix is up to 33 lowercase letters, digits, and underscores",
    });
  }
  return { ledger: `${prefix}_registry_ledger`, metadata: `${prefix}_registry_metadata` };
};

export interface TransactionalMigration {
  readonly sql: SqlClient.SqlClient;
  readonly capsuleId: string;
  readonly migrationId: number;
  readonly name: string;
  readonly checksum: string;
  readonly provider: string;
  /** The dialect this migration's checksum is keyed to. */
  readonly dialect: string;
  readonly operations: ReadonlyArray<Operation>;
  readonly ledgerTable: string;
}

/**
 * Run one ledger claim and its provider body as one transaction.
 *
 * The client comes from the host's Effect environment. In particular, this
 * helper never acquires a new connection and does not manage a client scope.
 * Nested calls therefore retain the transaction context of a PostgreSQL
 * coordination transaction or use the driver's savepoint semantics.
 */
export const runTransactionalMigration = (
  options: TransactionalMigration,
): Effect.Effect<void, SqlError | ProviderMismatch | PreparationFailed> =>
  options.sql.withTransaction(
    Effect.gen(function* () {
      yield* options.sql`INSERT INTO ${options.sql(options.ledgerTable)}
        (capsule_id, migration_id, name, checksum, applied_at, provider, dialect)
        VALUES (${options.capsuleId}, ${options.migrationId}, ${options.name},
          ${options.checksum}, ${new Date().toISOString()}, ${options.provider},
          ${options.dialect})`;

      for (const operation of options.operations) {
        if (operation._tag === "Sql") {
          for (const statement of operation.statements) {
            yield* options.sql.unsafe(statement);
          }
          continue;
        }

        // Effect steps are allowed only for transactional profiles and are
        // constrained to the host SQL client by the public constructor.
        // Supplying this exact client preserves composition with callers that
        // use the transaction service directly (for example Effect Drizzle).
        yield* operation.execute.pipe(
          Effect.provideService(SqlClient.SqlClient, options.sql),
          Effect.mapError(
            (cause) =>
              new PreparationFailed({
                reason: `Effect migration step ${operation.revision} failed: ${String(cause)}`,
              }),
          ),
        );
      }
    }),
  );
