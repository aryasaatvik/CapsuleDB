import { assert, describe, it } from "@effect/vitest";
import type { PlanStatusSession, ScopedPlanStatusSession } from "alchemy/Report";
import { Effect, Redacted } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  Registry as RegistryResource,
  RegistryProvider,
  type RegistryAttributes,
  type RegistryProps,
} from "../../src/Alchemy.ts";
import { profile as postgresProfile } from "../../src/Pg.ts";
import * as Registry from "../../src/Registry.ts";
import { makeFixtureCapsule, makeFixtureMigration } from "../fixtures/migrations.ts";
import { recordStatements } from "../fixtures/statements.ts";
import { withPostgres } from "./postgres.ts";

const create = makeFixtureMigration(
  1,
  "create-deployed",
  'CREATE TABLE "deployed_rows" (id TEXT PRIMARY KEY)',
);
const index = makeFixtureMigration(
  2,
  "index-deployed",
  'CREATE INDEX "deployed_rows_id" ON "deployed_rows" (id)',
);
const v1 = [makeFixtureCapsule([create], "deployed.rows")];
const v2 = [makeFixtureCapsule([create, index], "deployed.rows")];

const propsFor = (url: Redacted.Redacted<string>, capsules: typeof v1) =>
  Registry.manifest({ provider: postgresProfile, capsules }).pipe(
    Effect.map((manifest): RegistryProps => ({
      url,
      provider: "Postgres",
      manifest: JSON.parse(JSON.stringify(manifest)),
    })),
  );

/** A plan-status session that keeps the notes a provider writes. */
const recordingSession = () => {
  const notes: Array<string> = [];
  const base: PlanStatusSession = { emit: () => Effect.void, done: () => Effect.void };
  const session: ScopedPlanStatusSession = {
    ...base,
    note: (note) => Effect.sync(() => void notes.push(note)),
  };
  return { notes, session };
};

const lifecycle = { id: "registry", fqn: "registry", instanceId: "registry-instance" };

/** The provider service the engine would resolve for `CapsuleDB.Registry`. */
const provider = RegistryResource.Provider.pipe(Effect.provide(RegistryProvider()));

const reconcile = (news: RegistryProps, olds?: RegistryProps, output?: RegistryAttributes) =>
  Effect.gen(function* () {
    const service = yield* provider;
    const { session } = recordingSession();
    return yield* service.reconcile({ ...lifecycle, news, olds, output, session, bindings: [] });
  });

const read = (olds: RegistryProps) =>
  Effect.gen(function* () {
    const service = yield* provider;
    if (service.read === undefined) return assert.fail("the provider must implement read");
    return yield* service.read({ ...lifecycle, olds, output: undefined });
  });

const diff = (olds: RegistryProps, news: RegistryProps) =>
  Effect.gen(function* () {
    const service = yield* provider;
    if (service.diff === undefined) return assert.fail("the provider must implement diff");
    return yield* service.diff({
      ...lifecycle,
      olds,
      news,
      oldBindings: [],
      newBindings: [],
      output: undefined,
    });
  });

const tables = Effect.gen(function* () {
  const sql = yield* Effect.service(SqlClient.SqlClient);
  const rows = yield* sql<{ readonly table_name: string }>`SELECT table_name
    FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`;
  return rows.map((row) => row.table_name);
});

describe("CapsuleDB.Registry Alchemy resource", () => {
  it.effect(
    "creates on an empty database, reruns without writing, and updates for a new migration",
    () =>
      withPostgres((_client, url) =>
        Effect.gen(function* () {
          const first = yield* propsFor(url, v1);
          assert.isUndefined(yield* read(first));

          const created = yield* reconcile(first);
          assert.strictEqual(created.fingerprint, first.manifest.fingerprint);
          assert.deepStrictEqual(created, {
            fingerprint: first.manifest.fingerprint,
            provider: "postgres",
            capsules: 1,
            prefix: "capsuledb",
          });
          assert.deepStrictEqual(yield* tables, [
            "capsuledb_registry_ledger",
            "capsuledb_registry_metadata",
            "deployed_rows",
          ]);
          assert.deepStrictEqual(yield* read(first), created);

          // An unchanged deploy plans nothing, and a forced rerun only reads.
          assert.deepStrictEqual(yield* diff(first, first), { action: "noop" });
          const [rerun, recording] = yield* recordStatements(reconcile(first, first, created));
          assert.deepStrictEqual(rerun, created);
          assert.strictEqual(recording.statements.length, 1);
          assert.strictEqual(recording.transactions, 0);

          const second = yield* propsFor(url, v2);
          assert.deepStrictEqual(yield* diff(first, second), { action: "update" });
          assert.isUndefined(yield* read(second));
          const updated = yield* reconcile(second, first, created);
          assert.strictEqual(updated.fingerprint, second.manifest.fingerprint);
          assert.strictEqual(
            (yield* Registry.status({ provider: postgresProfile, capsules: v2 }))._tag,
            "Ready",
          );
        }),
      ),
    60_000,
  );

  it.effect(
    "adopts a database the runtime already prepared without DDL",
    () =>
      withPostgres((_client, url) =>
        Effect.gen(function* () {
          yield* Registry.prepare({ provider: postgresProfile, capsules: v1 });
          const props = yield* propsFor(url, v1);

          const adopted = yield* read(props);
          assert.isDefined(adopted);
          if (adopted === undefined) return;
          const [attributes, recording] = yield* recordStatements(
            reconcile(props, undefined, adopted),
          );
          assert.deepStrictEqual(attributes, adopted);
          assert.strictEqual(recording.statements.length, 1);
          assert.strictEqual(recording.transactions, 0);
        }),
      ),
    60_000,
  );

  it.effect(
    "diffs on the target and keeps the data on delete",
    () =>
      withPostgres((_client, url) =>
        Effect.gen(function* () {
          const props = yield* propsFor(url, v1);
          assert.deepStrictEqual(
            yield* diff(props, { ...props, url: Redacted.make(`${Redacted.value(url)}&x=1`) }),
            { action: "update" },
          );
          assert.deepStrictEqual(yield* diff(props, { ...props, prefix: "other" }), {
            action: "update",
          });
          assert.deepStrictEqual(yield* diff(props, { ...props, allowDestructive: true }), {
            action: "update",
          });
          // Spelling out a default is not a change.
          assert.deepStrictEqual(yield* diff(props, { ...props, prefix: "capsuledb" }), {
            action: "noop",
          });

          const output = yield* reconcile(props);
          const service = yield* provider;
          const { session } = recordingSession();
          yield* service.delete({ ...lifecycle, olds: props, output, session, bindings: [] });
          assert.deepStrictEqual(yield* tables, [
            "capsuledb_registry_ledger",
            "capsuledb_registry_metadata",
            "deployed_rows",
          ]);
        }),
      ),
    60_000,
  );

  it.effect(
    "fails reconcile on a tampered manifest without touching the database",
    () =>
      withPostgres((_client, url) =>
        Effect.gen(function* () {
          const props = yield* propsFor(url, v1);
          const tampered: RegistryProps = {
            ...props,
            manifest: { ...props.manifest, fingerprint: "0".repeat(64) },
          };
          const failure = yield* reconcile(tampered).pipe(Effect.flip);
          assert.strictEqual(
            typeof failure === "object" && failure !== null && "_tag" in failure
              ? failure._tag
              : undefined,
            "ManifestFingerprintDrift",
          );
          assert.deepStrictEqual(yield* tables, []);
        }),
      ),
    60_000,
  );
});
