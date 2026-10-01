/**
 * Deploy-time registry preparation as an Alchemy resource.
 *
 * A serverless host that prepares its registry while booting pays for it on
 * every cold start. This resource moves that work into `alchemy deploy`: the
 * stack prepares the database from the registry's manifest before new function
 * code publishes, and the function boots with `Registry.layer({ mode: "assert",
 * readiness: "first-use" })`, whose check is a single read.
 *
 * This subpath needs the optional peers `alchemy` and `@effect/sql-pg`; the
 * package root never imports either.
 */
import { PgClient } from "@effect/sql-pg";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { Effect, Layer, Redacted } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";

import type { Manifest } from "./Manifest.ts";
import { PostgresProfile, providerName, type ProviderProfile } from "./Provider.ts";
import { prepare, status } from "./Registry.ts";
import type { Ready } from "./Readiness.ts";
import { DEFAULT_PREFIX } from "./internal/transactional-migrator.ts";

/** What the stack declares for one registry in one database. */
export interface RegistryProps {
  /** Connection URL of the database the registry lives in. */
  url: Redacted.Redacted<string>;
  /**
   * The engine behind `url`. Each value names the driver the resource opens,
   * so another engine arrives as another member of this union.
   */
  provider: "Postgres";
  /**
   * The registry's published manifest, usually
   * `yield* Registry.manifest({ provider, capsules })` evaluated in the stack.
   * It is verified before the database is touched.
   */
  manifest: typeof Manifest.Encoded;
  /**
   * Prefix of the registry's ledger and metadata tables; must match the prefix
   * the runtime `Registry.layer` uses.
   *
   * @default "capsuledb"
   */
  prefix?: string;
  /**
   * Permit migrations marked `destructive`.
   *
   * @default false
   */
  allowDestructive?: boolean;
  /**
   * Permit re-keying a ledger written before per-dialect checksums.
   *
   * @default false
   */
  allowLegacyLedgerUpgrade?: boolean;
}

/** The readiness a successful reconcile recorded. */
export interface RegistryAttributes {
  /**
   * Fingerprint of the prepared manifest. Pass it to the function's
   * environment so a new code version depends on the preparation it needs.
   */
  fingerprint: string;
  /** Provider identity stamped into the ledger, such as `postgres`. */
  provider: string;
  /** Number of capsules the manifest registers. */
  capsules: number;
  /** Prefix of the registry's tables. */
  prefix: string;
}

export class Providers extends Provider.ProviderCollection<Providers>()("CapsuleDB") {}

export type Registry = Resource<
  "CapsuleDB.Registry",
  RegistryProps,
  RegistryAttributes,
  never,
  Providers
>;

/**
 * A CapsuleDB registry prepared at deploy time.
 *
 * Reconcile opens a client on `url`, runs `Registry.prepare` from the
 * manifest, and closes the client. An already-current database answers in one
 * read with no lock and no DDL, so an unchanged deploy, a rerun, and adoption
 * of a database the runtime prepared all converge without writing. Diff
 * reports an update only when the target or the manifest fingerprint changes.
 *
 * Delete never drops tables. Capsule data outlives the stack that prepared it,
 * exactly as it outlives a capsule removed from a registry: dropping it is an
 * operator's decision, made with a destructive migration.
 *
 * ### Preparing before the function publishes
 *
 * **Example:** Prepare DomainKit's capsule and hand the fingerprint to a function
 * ```typescript
 * import * as CapsuleDB from "capsuledb/alchemy";
 * import { Pg, Registry } from "capsuledb";
 *
 * const registry = yield* CapsuleDB.Registry("domainkit-registry", {
 *   url: databaseUrl,
 *   provider: "Postgres",
 *   manifest: yield* Registry.manifest({ provider: Pg.profile, capsules: [capsule] }),
 * });
 *
 * // A version-scoped env value orders the function after the preparation.
 * env: { CAPSULEDB_FINGERPRINT: registry.fingerprint }
 * ```
 *
 * @resource
 */
export const Registry = Resource<Registry>("CapsuleDB.Registry");

const profileOf = (provider: RegistryProps["provider"]): ProviderProfile => {
  switch (provider) {
    case "Postgres":
      return PostgresProfile;
  }
};

/** Run one registry operation over a client this resource opens and closes. */
const withDatabase = <A, E>(
  props: RegistryProps,
  operation: (provider: ProviderProfile) => Effect.Effect<A, E, SqlClient.SqlClient>,
) => {
  const provider = profileOf(props.provider);
  return operation(provider).pipe(Effect.provide(Layer.fresh(PgClient.layer({ url: props.url }))));
};

const optionsOf = (props: RegistryProps, provider: ProviderProfile) => ({
  provider,
  manifest: props.manifest,
  prefix: props.prefix ?? DEFAULT_PREFIX,
  allowDestructive: props.allowDestructive ?? false,
  allowLegacyLedgerUpgrade: props.allowLegacyLedgerUpgrade ?? false,
});

const attributesOf = (props: RegistryProps, ready: Ready): RegistryAttributes => ({
  fingerprint: ready.fingerprint,
  provider: ready.provider,
  capsules: ready.capsules,
  prefix: props.prefix ?? DEFAULT_PREFIX,
});

/** The props that decide which database is prepared, and to what. */
const targetOf = (props: RegistryProps) => ({
  url: Redacted.value(props.url),
  provider: props.provider,
  fingerprint: props.manifest.fingerprint,
  prefix: props.prefix ?? DEFAULT_PREFIX,
  allowDestructive: props.allowDestructive ?? false,
  allowLegacyLedgerUpgrade: props.allowLegacyLedgerUpgrade ?? false,
});

const sameTarget = (olds: RegistryProps, news: RegistryProps): boolean => {
  const before = targetOf(olds);
  const after = targetOf(news);
  return (Object.keys(after) as Array<keyof typeof after>).every(
    (key) => before[key] === after[key],
  );
};

/** The lifecycle behind {@link Registry}. */
export const RegistryProvider = () =>
  Provider.effect(
    Registry,
    Effect.succeed({
      diff: ({ olds, news }) =>
        Effect.sync(() => {
          if (!isResolved(news)) return undefined;
          return sameTarget(olds, news)
            ? { action: "noop" as const }
            : { action: "update" as const };
        }),
      // A database whose registry is not Ready for these props is reported
      // missing, so the engine reconciles it rather than trusting stale state.
      read: ({ olds }) =>
        withDatabase(olds, (provider) => status(optionsOf(olds, provider))).pipe(
          Effect.map((readiness) =>
            readiness._tag === "Ready" ? attributesOf(olds, readiness) : undefined,
          ),
        ),
      reconcile: ({ news, session }) =>
        Effect.gen(function* () {
          const ready = yield* withDatabase(news, (provider) => prepare(optionsOf(news, provider)));
          yield* session.note(
            `registry ${ready.fingerprint.slice(0, 12)} ready (${ready.capsules} capsule(s), ${providerName(profileOf(news.provider).provider)})`,
          );
          return attributesOf(news, ready);
        }),
      delete: () => Effect.void,
    }),
  );

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Deploy-time providers for CapsuleDB resources. Merge them into the stack's
 * `providers` layer.
 */
export const providers = () =>
  Layer.effect(Providers, Provider.collection([Registry])).pipe(
    Layer.provide(RegistryProvider()),
    Layer.orDie,
  );
