import { PgClient } from "@effect/sql-pg";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";

import { profile as postgresProfile } from "../../src/Pg.ts";
import * as Registry from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import {
  OneTimeTokens,
  layer as tokenLayer,
} from "../../examples/reference-token/OneTimeTokens.ts";
import { withPostgres } from "./postgres.ts";

describe("PostgreSQL Effect Drizzle composition", () => {
  it.effect(
    "rolls back Drizzle and capsule writes through one host client",
    () =>
      withPostgres((client) =>
        Effect.gen(function* () {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const capsule = referenceTokenCapsule;
              const registry = {
                provider: postgresProfile,
                capsules: [capsule],
              };
              yield* Registry.prepare(registry);

              const db = yield* PgDrizzle.makeWithDefaults().pipe(
                Effect.provideService(PgClient.PgClient, client),
              );
              const service = yield* Effect.service(OneTimeTokens);

              yield* client.unsafe(
                'CREATE TABLE "postgres_drizzle_composition" (value INTEGER NOT NULL)',
              );
              const failed = yield* db
                .transaction((tx) =>
                  Effect.gen(function* () {
                    yield* tx.execute(
                      sql`INSERT INTO "postgres_drizzle_composition" (value) VALUES (1)`,
                    );
                    yield* service.issue("2099-01-01T00:00:00.000Z");
                    return yield* Effect.fail("rollback shared transaction");
                  }),
                )
                .pipe(Effect.flip);
              assert.strictEqual(failed, "rollback shared transaction");

              assert.deepStrictEqual(
                yield* client<{ readonly count: number }>`SELECT COUNT(*)::integer AS count
                  FROM "postgres_drizzle_composition"`,
                [{ count: 0 }],
              );
              assert.deepStrictEqual(
                yield* client<{ readonly count: number }>`SELECT COUNT(*)::integer AS count
                  FROM "capsule_reference_2e_tokens"`,
                [{ count: 0 }],
              );
            }).pipe(Effect.provide(tokenLayer)),
          );
        }),
      ),
    60_000,
  );
});
