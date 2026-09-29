import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import * as GatedClient from "../../src/internal/gated-client.ts";

const withSqlite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);

describe("first-use client gate", () => {
  it.effect("gates driver members that return an Effect or a Stream", () =>
    withSqlite(
      Effect.gen(function* () {
        const sql = yield* Effect.service(SqlClient.SqlClient);
        // Driver clients add members beyond `SqlClient`; these stand in for
        // D1's `batch` (an Effect) and a listener (a Stream).
        let ran = 0;
        const driver = Object.assign(sql, {
          ping: () => Effect.sync(() => (ran += 1)),
          events: () => Stream.fromEffect(Effect.sync(() => (ran += 1))),
          dialectName: "sqlite",
        });

        let ready = false;
        const gated = yield* GatedClient.make(
          driver,
          Effect.suspend(() => (ready ? Effect.void : Effect.fail("not ready"))),
        );
        // The gate carries members it cannot type; this is the shape it promises
        // for them, with the readiness failure added to each error channel.
        const members = gated as unknown as {
          readonly ping: () => Effect.Effect<number, SqlError>;
          readonly events: () => Stream.Stream<number, SqlError>;
          readonly dialectName: string;
        };
        assert.strictEqual(members.dialectName, "sqlite");

        const pingFailure = yield* members.ping().pipe(Effect.flip);
        assert.strictEqual(pingFailure._tag, "SqlError");
        const streamFailure = yield* Stream.runCollect(members.events()).pipe(Effect.flip);
        assert.strictEqual(streamFailure._tag, "SqlError");
        assert.strictEqual(ran, 0);

        ready = true;
        yield* members.ping();
        yield* Stream.runCollect(members.events());
        assert.strictEqual(ran, 2);
      }),
    ),
  );
});
