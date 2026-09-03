import { assert, vi } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { providerName } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import { capsule as referenceTokenCapsule } from "../../examples/reference-token/Capsule.ts";
import {
  OneTimeTokens,
  layer as tokenLayer,
} from "../../examples/reference-token/OneTimeTokens.ts";
import type { ProviderCase } from "../providers/cases.ts";

/**
 * Run the provider-neutral public behavior against one host-owned client.
 * Provider-specific fixtures supply only the client; all lifecycle and domain
 * assertions below are deliberately shared across the complete matrix.
 */
export const runProviderSuite = (
  provider: ProviderCase,
  client: SqlClient.SqlClient,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const capsule = referenceTokenCapsule;
    const registry = {
      provider: provider.profile,
      capsules: [capsule],
    };
    const registryManifest = yield* Registry.manifest(registry);
    const pending = yield* Registry.status(registry);
    assert.strictEqual(pending._tag, "Pending");

    const firstReceipt = yield* Registry.prepare(registry);
    assert.strictEqual(firstReceipt.provider, providerName(provider.profile.provider));
    assert.strictEqual(firstReceipt.fingerprint, registryManifest.fingerprint);
    assert.strictEqual((yield* Registry.status(registry))._tag, "Ready");

    const secondReceipt = yield* Registry.prepare(registry);
    assert.deepStrictEqual(secondReceipt, firstReceipt);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* Effect.service(OneTimeTokens);
        const invalidExpiry = yield* service.issue("01/01/2099").pipe(Effect.flip);
        assert.strictEqual(invalidExpiry._tag, "InvalidToken");

        const issued = yield* service.issue("2099-01-01T00:00:00.000Z");
        assert.strictEqual((yield* service.get(issued.token))._tag, "Pending");
        const consumed = yield* service.consume(issued.token);
        assert.strictEqual(consumed.token, issued.token);
        assert.strictEqual((yield* service.get(issued.token))._tag, "Consumed");

        const replay = yield* service.consume(issued.token).pipe(Effect.flip);
        assert.strictEqual(replay._tag, "TokenAlreadyConsumed");
        const missing = yield* service
          .get("0000000000000000000000000000000000000000000000000000000000000000")
          .pipe(Effect.flip);
        assert.strictEqual(missing._tag, "TokenNotFound");

        const revoked = yield* service.issue("2099-01-01T00:00:00.000Z");
        yield* service.revoke(revoked.token);
        assert.strictEqual((yield* service.get(revoked.token))._tag, "Revoked");
        const revokedConsume = yield* service.consume(revoked.token).pipe(Effect.flip);
        assert.strictEqual(revokedConsume._tag, "TokenNotFound");

        const concurrentToken = yield* service.issue("2099-01-01T00:00:00.000Z");
        const concurrent = yield* Effect.all(
          [1, 2].map(() =>
            service.consume(concurrentToken.token).pipe(
              Effect.match({
                onFailure: (error) => ({ _tag: "Failure" as const, error }),
                onSuccess: (receipt) => ({ _tag: "Success" as const, receipt }),
              }),
            ),
          ),
          { concurrency: "unbounded" },
        );
        assert.strictEqual(concurrent.filter((result) => result._tag === "Success").length, 1);
        assert.strictEqual(concurrent.filter((result) => result._tag === "Failure").length, 1);
      }).pipe(Effect.provide(tokenLayer), Effect.provideService(SqlClient.SqlClient, client)),
    );

    yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* Effect.service(OneTimeTokens);
        const issuedBeforeSkew = yield* service.issue("2099-01-01T00:00:00.000Z");

        vi.useFakeTimers();
        vi.setSystemTime(new Date("2200-01-01T00:00:00.000Z"));

        assert.strictEqual((yield* service.get(issuedBeforeSkew.token))._tag, "Pending");
        const consumed = yield* service.consume(issuedBeforeSkew.token);
        assert.strictEqual(consumed.token, issuedBeforeSkew.token);
        assert.notStrictEqual(consumed.consumedAt, "2200-01-01T00:00:00.000Z");

        const issuedDuringSkew = yield* service.issue("2099-01-01T00:00:00.000Z");
        yield* service.revoke(issuedDuringSkew.token);
        const revoked = yield* service.get(issuedDuringSkew.token);
        assert.strictEqual(revoked._tag, "Revoked");
        if (revoked._tag === "Revoked") {
          assert.notStrictEqual(revoked.revokedAt, "2200-01-01T00:00:00.000Z");
        }
      }).pipe(
        Effect.provide(tokenLayer),
        Effect.provideService(SqlClient.SqlClient, client),
        Effect.ensuring(Effect.sync(() => vi.useRealTimers())),
      ),
    );

    assert.deepStrictEqual(yield* client<{ readonly value: number }>`SELECT 2 AS value`, [
      { value: 2 },
    ]);
  }).pipe(Effect.provideService(SqlClient.SqlClient, client));
