import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { PreparationFailed, ProviderMismatch } from "../Error.ts";
import type { Operation } from "../Migration.ts";

/** Private tables owned by CapsuleDB's provider-neutral lifecycle. */
export const LEDGER_TABLE = "capsuledb_registry_ledger";
export const METADATA_TABLE = "capsuledb_registry_metadata";

export interface TransactionalMigration {
  readonly sql: SqlClient.SqlClient;
  readonly capsuleId: string;
  readonly migrationId: number;
  readonly name: string;
  readonly checksum: string;
  readonly provider: string;
  readonly operations: ReadonlyArray<Operation>;
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
      yield* options.sql`INSERT INTO ${options.sql(LEDGER_TABLE)}
        (capsule_id, migration_id, name, checksum, applied_at, provider)
        VALUES (${options.capsuleId}, ${options.migrationId}, ${options.name},
          ${options.checksum}, ${new Date().toISOString()}, ${options.provider})`;

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
