/**
 * Integration sketch for an Executor-style boot-time plugin registry. It is
 * intentionally a plain Effect Layer: no Executor package is imported and this
 * repository makes no claim that Executor has adopted CapsuleDB.
 */
import type { Layer } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { Capsule, Pg, Registry } from "capsuledb";

/**
 * A host composes the capsules it trusts into one Layer. Preparation runs
 * while the Layer is built, so a plugin's service is only reachable after its
 * migrations have been applied.
 */
export const executorPluginLayer = <Service>(
  capsule: Capsule.Capsule<Service, never, SqlClient.SqlClient>,
): Layer.Layer<Service, Registry.RegistryRuntimeError, SqlClient.SqlClient> =>
  Registry.layer({ provider: Pg.profile, capsules: [capsule] });
