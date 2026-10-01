/**
 * Integration sketch for a serverless host that prepares its registry at
 * deploy time with Alchemy and checks it lazily at runtime. The stack and the
 * function share one capsule list, so the manifest the deploy prepares is the
 * manifest the function asserts.
 */
import { Effect, type Layer, type Redacted } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";

import { type Capsule, Pg, Registry } from "capsuledb";
import * as CapsuleDB from "capsuledb/alchemy";

/** Deploy time: prepare the database before the new function version publishes. */
export const prepareAtDeploy = (
  url: Redacted.Redacted<string>,
  capsules: ReadonlyArray<Capsule.Capsule<unknown, never, SqlClient.SqlClient>>,
) =>
  Effect.gen(function* () {
    const manifest = yield* Registry.manifest({ provider: Pg.profile, capsules });
    const registry = yield* CapsuleDB.Registry("capsules", {
      url,
      provider: "Postgres",
      manifest,
    });
    // Hand this to the function as a version-scoped environment value, so a
    // code version is published only after the preparation it depends on.
    return registry.fingerprint;
  });

/** Register next to the stack's other providers. */
export const deployProviders = CapsuleDB.providers;

/**
 * Run time: the Layer builds without a statement, and the first capsule query
 * asserts readiness in one read. A cold start that never touches a capsule
 * does no registry work at all.
 */
export const capsulesAtRuntime = <Service>(
  capsule: Capsule.Capsule<Service, never, SqlClient.SqlClient>,
): Layer.Layer<Service, Registry.RegistryRuntimeError, SqlClient.SqlClient> =>
  Registry.layer({
    provider: Pg.profile,
    capsules: [capsule],
    mode: "assert",
    readiness: "first-use",
  });
