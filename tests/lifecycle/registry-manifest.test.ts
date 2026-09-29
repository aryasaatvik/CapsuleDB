import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Capsule from "../../src/Capsule.ts";
import type { Manifest } from "../../src/Manifest.ts";
import * as Migration from "../../src/Migration.ts";
import { profile as postgresProfile } from "../../src/Pg.ts";
import { BunSqliteProfile, type ProviderProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import { makeFixtureCapsule, makeFixtureMigration } from "../fixtures/migrations.ts";
import { recordStatements } from "../fixtures/statements.ts";
import { withPostgres } from "../providers/postgres.ts";

const create = makeFixtureMigration(
  1,
  "create-ledgered",
  'CREATE TABLE "manifest_ledgered" (id TEXT PRIMARY KEY)',
);
const index = makeFixtureMigration(
  2,
  "index-ledgered",
  'CREATE INDEX "manifest_ledgered_id" ON "manifest_ledgered" (id)',
);
const first = makeFixtureCapsule([create], "manifest.ledgered");
const grown = makeFixtureCapsule([create, index], "manifest.ledgered");
const other = makeFixtureCapsule(
  [makeFixtureMigration(1, "create-other", 'CREATE TABLE "manifest_other" (id TEXT PRIMARY KEY)')],
  "manifest.other",
);

/** A manifest as a deploy tool holds it: plain JSON, brands and all gone. */
const published = (provider: ProviderProfile, capsules: ReadonlyArray<typeof first>) =>
  Registry.manifest({ provider, capsules }).pipe(
    Effect.map((manifest): typeof Manifest.Encoded => JSON.parse(JSON.stringify(manifest))),
  );

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);

/** Either path prepares a database the other reads as current in one statement. */
const equivalence = (provider: ProviderProfile) =>
  Effect.gen(function* () {
    const capsules = [first, other];
    const manifest = yield* published(provider, capsules);

    const fromManifest = yield* Registry.prepare({ provider, manifest });
    const [fromCapsules, capsuleRead] = yield* recordStatements(
      Registry.prepare({ provider, capsules }),
    );
    assert.deepStrictEqual(fromCapsules, fromManifest);
    assert.strictEqual(capsuleRead.statements.length, 1);

    // Growing the history through capsules is read back through a manifest.
    const grownCapsules = [grown, other];
    yield* Registry.prepare({ provider, capsules: grownCapsules });
    const grownManifest = yield* published(provider, grownCapsules);
    const [readiness, manifestRead] = yield* recordStatements(
      Registry.status({ provider, manifest: grownManifest }),
    );
    assert.strictEqual(readiness._tag, "Ready");
    assert.strictEqual(manifestRead.statements.length, 1);
    const [, manifestPrepare] = yield* recordStatements(
      Registry.prepare({ provider, manifest: grownManifest }),
    );
    assert.strictEqual(manifestPrepare.statements.length, 1);
  });

describe("registry preparation from a manifest", () => {
  it.effect("prepares SQLite equivalently to the capsules that produced it", () =>
    withSqlite(equivalence(BunSqliteProfile)),
  );

  it.effect(
    "prepares PostgreSQL equivalently to the capsules that produced it",
    () => withPostgres(() => equivalence(postgresProfile)),
    60_000,
  );

  it.effect("applies only the migrations a newer manifest adds", () =>
    withSqlite(
      Effect.gen(function* () {
        yield* Registry.prepare({
          provider: BunSqliteProfile,
          manifest: yield* published(BunSqliteProfile, [first]),
        });
        const manifest = yield* published(BunSqliteProfile, [grown]);
        assert.strictEqual(
          (yield* Registry.status({ provider: BunSqliteProfile, manifest }))._tag,
          "Pending",
        );
        const ready = yield* Registry.prepare({ provider: BunSqliteProfile, manifest });
        assert.strictEqual(ready.fingerprint, manifest.fingerprint);

        const sql = yield* Effect.service(SqlClient.SqlClient);
        assert.deepStrictEqual(
          yield* sql`SELECT name FROM sqlite_master WHERE name = 'manifest_ledgered_id'`,
          [{ name: "manifest_ledgered_id" }],
        );
        assert.strictEqual(
          (yield* Registry.status({ provider: BunSqliteProfile, capsules: [grown] }))._tag,
          "Ready",
        );
      }),
    ),
  );

  it.effect("refuses an edited manifest before touching the database", () =>
    withSqlite(
      Effect.gen(function* () {
        const manifest = yield* published(BunSqliteProfile, [first]);
        const [capsule] = manifest.capsules;
        const [migration] = capsule?.migrations ?? [];
        const [body] = migration?.bodies ?? [];
        if (capsule === undefined || migration === undefined || body === undefined) {
          return assert.fail("the fixture manifest has one body");
        }
        const tampered: typeof Manifest.Encoded = {
          ...manifest,
          capsules: [
            {
              ...capsule,
              migrations: [
                {
                  ...migration,
                  bodies: [
                    {
                      ...body,
                      operations: [{ _tag: "Sql", statements: ['DROP TABLE "important"'] }],
                    },
                  ],
                },
              ],
            },
          ],
        };

        const [failure, recording] = yield* recordStatements(
          Registry.prepare({ provider: BunSqliteProfile, manifest: tampered }).pipe(Effect.flip),
        );
        assert.strictEqual(failure._tag, "MigrationChecksumDrift");
        assert.deepStrictEqual(recording.statements, []);
      }),
    ),
  );

  it.effect("refuses a migration with an Effect step, as emit does", () =>
    withSqlite(
      Effect.gen(function* () {
        const dynamic = Capsule.make({
          id: "manifest.dynamic",
          migrations: [
            Migration.make({
              id: 1,
              name: "seed",
              risk: "additive",
              steps: [Migration.effect("seed-v1", Effect.void)],
            }),
          ],
          layer: Layer.empty,
        });
        const manifest = yield* published(BunSqliteProfile, [dynamic]);
        const [failure, recording] = yield* recordStatements(
          Registry.prepare({ provider: BunSqliteProfile, manifest }).pipe(Effect.flip),
        );
        assert.strictEqual(failure._tag, "InvalidDefinition");
        assert.deepStrictEqual(recording.statements, []);
      }),
    ),
  );

  it.effect("refuses a manifest with no body for the provider's dialect", () =>
    withSqlite(
      Effect.gen(function* () {
        const postgresOnly = Capsule.make({
          id: "manifest.pg",
          migrations: [
            Migration.make({
              id: 1,
              name: "create-pg",
              risk: "additive",
              steps: [Migration.sql({ postgres: ['CREATE TABLE "pg_only" (id TEXT)'] })],
            }),
          ],
          layer: Layer.empty,
        });
        const manifest = yield* published(postgresProfile, [postgresOnly]);
        const failure = yield* Registry.prepare({ provider: BunSqliteProfile, manifest }).pipe(
          Effect.flip,
        );
        assert.strictEqual(failure._tag, "MissingProviderMigration");
      }),
    ),
  );
});
