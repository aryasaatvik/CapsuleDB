/**
 * Integration sketch for a Samva-style host with one shared Effect Drizzle
 * database. This is not a Samva adoption claim and intentionally has no
 * dependency on Samva's private relation definitions.
 */
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { Pg, makeRegistry, prepare, type AnyCapsule, type ReadinessReceipt } from "capsuledb";

/** The shared database object a host's Effect Drizzle layer exposes. */
export interface SharedSamvaStorage {
  readonly database: EffectPgDatabase;
  /** The underlying host-owned Effect SQL service used by CapsuleDB. */
  readonly sql: SqlClient.SqlClient;
}

/**
 * Prepare a capsule against the same SQL client used by the host's Drizzle
 * stores. CapsuleDB never creates a second pool or takes ownership of it.
 */
export const prepareSamvaCapsule = (
  capsule: AnyCapsule,
  storage: SharedSamvaStorage,
): Effect.Effect<ReadinessReceipt, unknown> =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({ provider: Pg.profile, capsules: [capsule] });
    return yield* prepare(registry).pipe(Effect.provideService(SqlClient.SqlClient, storage.sql));
  });
