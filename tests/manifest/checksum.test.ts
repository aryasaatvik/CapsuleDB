import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { Digest } from "effect/crypto";

import { InvalidDefinition } from "../../src/Error.ts";
import { sha256 } from "../../src/internal/checksum.ts";

describe("sha256 checksum compatibility", () => {
  it.effect("pins known inputs to their lowercase SHA-256 digests", () =>
    Effect.gen(function* () {
      // FIPS 180-4 SHA-256 vectors. Ledger rows store this exact encoding.
      assert.strictEqual(
        yield* sha256(""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      assert.strictEqual(
        yield* sha256("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    }),
  );

  it.effect("uses the supplied Digest service with SHA-256 and UTF-8 bytes", () =>
    Effect.gen(function* () {
      const service = Digest.Digest.of({
        digest: () => Effect.die("unexpected binary digest call"),
        digestHex: (algorithm, bytes) =>
          Effect.sync(() => {
            assert.strictEqual(algorithm, Digest.sha256);
            assert.deepStrictEqual(bytes, new Uint8Array([99, 97, 102, 195, 169]));
            return "supplied-digest";
          }),
      });
      assert.strictEqual(
        yield* sha256("café").pipe(Effect.provideService(Digest.Digest, service)),
        "supplied-digest",
      );
    }),
  );

  it.effect("reports digest defects as InvalidDefinition", () =>
    Effect.gen(function* () {
      const service = Digest.Digest.of({
        digest: () => Effect.die("unexpected binary digest call"),
        digestHex: () => Effect.die("digest unavailable"),
      });
      const error = yield* sha256("abc").pipe(
        Effect.provideService(Digest.Digest, service),
        Effect.flip,
      );
      assert.instanceOf(error, InvalidDefinition);
      assert.strictEqual(error.subject, "manifest checksum");
      assert.include(error.reason, "digest unavailable");
    }),
  );

  it.effect("preserves digest interruption", () =>
    Effect.gen(function* () {
      const service = Digest.Digest.of({
        digest: () => Effect.die("unexpected binary digest call"),
        digestHex: () => Effect.interrupt,
      });
      const exit = yield* sha256("abc").pipe(
        Effect.provideService(Digest.Digest, service),
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
    }),
  );
});
