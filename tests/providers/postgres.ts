import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

/**
 * Run a PostgreSQL assertion against one disposable local container and one
 * host-owned Effect client. CapsuleDB receives only the generic client layer.
 */
export const withPostgres = <A, E>(
  effect: (client: PgClient.PgClient) => Effect.Effect<A, E, SqlClient.SqlClient>,
): Effect.Effect<A, E | SqlError> =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("capsuledb")
        .withUsername("capsuledb")
        .withPassword("capsuledb")
        .start(),
    ),
    (container: StartedPostgreSqlContainer) =>
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* PgClient.make({
            url: Redacted.make(container.getConnectionUri()),
            maxConnections: 4,
          }).pipe(Effect.provide(Reactivity.layer));
          return yield* effect(client).pipe(
            Effect.provide(PgClient.layerFrom(Effect.succeed(client))),
          );
        }),
      ),
    (container: StartedPostgreSqlContainer) => Effect.promise(() => container.stop()),
  );
