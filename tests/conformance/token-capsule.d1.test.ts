import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { profile as d1Profile } from "../../src/D1.ts";
import { makeRegistry, prepare, status } from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import {
  OneTimeTokens,
  layer as tokenLayer,
} from "../../examples/reference-token/OneTimeTokens.ts";
import { withD1 } from "../providers/d1.ts";

describe("reference token capsule over a host-supplied D1 binding", () => {
  it.effect(
    "prepares, consumes once through one atomic batch, and preserves the host client",
    () =>
      withD1((client) =>
        Effect.gen(function* () {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const capsule = yield* referenceTokenCapsule;
              const registry = yield* makeRegistry({
                provider: d1Profile,
                capsules: [capsule],
              });
              const receipt = yield* prepare(registry);
              assert.strictEqual(receipt.provider, "d1");
              assert.strictEqual((yield* status(registry))._tag, "Ready");

              const service = yield* Effect.service(OneTimeTokens);
              const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
              const consumed = yield* service.consume(issued.token);
              assert.strictEqual(consumed.token, issued.token);
              const replay = yield* service.consume(issued.token).pipe(Effect.flip);
              assert.strictEqual(replay._tag, "TokenAlreadyConsumed");
            }).pipe(Effect.provide(tokenLayer)),
          );

          const rows = yield* client<{ readonly value: number }>`SELECT 2 AS value`;
          assert.deepStrictEqual(rows, [{ value: 2 }]);
        }),
      ),
    60_000,
  );

  it.effect(
    "rolls back token consumption when the audit statement fails",
    () =>
      withD1((client) =>
        Effect.scoped(
          Effect.gen(function* () {
            const capsule = yield* referenceTokenCapsule;
            const registry = yield* makeRegistry({
              provider: d1Profile,
              capsules: [capsule],
            });
            yield* prepare(registry);
            const service = yield* Effect.service(OneTimeTokens);
            const issued = yield* service.issue("2099-01-01T00:00:00.000Z");

            yield* client.unsafe(`CREATE TRIGGER fail_d1_token_audit
              BEFORE INSERT ON "capsule_reference_2e_token_audit"
              BEGIN SELECT RAISE(ABORT, 'audit failure'); END`);
            const failure = yield* service.consume(issued.token).pipe(Effect.flip);
            assert.strictEqual(failure._tag, "TokenPersistenceError");
            assert.strictEqual((yield* service.get(issued.token))._tag, "Pending");
            assert.deepStrictEqual(
              yield* client<{ readonly count: number }>`SELECT COUNT(*) AS count
                FROM "capsule_reference_2e_token_audit"`,
              [{ count: 0 }],
            );
          }).pipe(Effect.provide(tokenLayer)),
        ),
      ),
    60_000,
  );
});
