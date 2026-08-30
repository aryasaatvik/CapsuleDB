import type { D1Database } from "@cloudflare/workers-types";
import { D1Client } from "@effect/sql-d1";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { Miniflare } from "miniflare";

/**
 * Run a D1 assertion against one disposable Miniflare database. The D1
 * binding and generic SQL client are host-owned; CapsuleDB only receives the
 * layer for the duration of the assertion.
 */
export const withD1 = <A, E>(
  effect: (client: D1Client.D1Client) => Effect.Effect<A, E, SqlClient.SqlClient>,
): Effect.Effect<A, E | Error> =>
  Effect.acquireUseRelease(
    Effect.sync(
      () =>
        new Miniflare({
          d1Databases: { DB: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
          modules: true,
          script: "",
        }),
    ),
    (miniflare) =>
      Effect.scoped(
        Effect.gen(function* () {
          const db: D1Database = yield* Effect.tryPromise({
            try: () => miniflare.getD1Database("DB"),
            catch: (cause) =>
              new Error(`Unable to create the Miniflare D1 binding: ${String(cause)}`),
          });
          const layer = D1Client.layer({ db });
          const client = yield* Effect.service(D1Client.D1Client).pipe(Effect.provide(layer));
          return yield* effect(client).pipe(Effect.provide(layer));
        }),
      ),
    (miniflare) => Effect.promise(() => miniflare.dispose()),
  );
