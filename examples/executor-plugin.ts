/**
 * Integration sketch for an Executor-style boot-time plugin registry. It is
 * intentionally a plain Effect function: no Executor package is imported and
 * this repository makes no claim that Executor has adopted CapsuleDB.
 */
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  Pg,
  makeRegistry,
  prepare,
  type AnyCapsule,
  type ReadinessReceipt,
  type Registry,
} from "capsuledb";

export interface ExecutorPluginContext {
  readonly capsule: AnyCapsule;
  readonly sql: SqlClient.SqlClient;
}

/**
 * A host can run this during plugin boot and expose the plugin only after the
 * readiness receipt succeeds.
 */
export const prepareExecutorPlugin = (
  context: ExecutorPluginContext,
): Effect.Effect<readonly [Registry, ReadinessReceipt], unknown> =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      provider: Pg.profile,
      capsules: [context.capsule],
    });
    const receipt = yield* prepare(registry).pipe(
      Effect.provideService(SqlClient.SqlClient, context.sql),
    );
    return [registry, receipt] as const;
  });
