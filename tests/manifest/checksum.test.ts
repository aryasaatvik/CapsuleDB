import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

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
});
