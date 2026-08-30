import { Crypto, Effect, Option } from "effect";

import { InvalidDefinition } from "../Error.ts";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const platformCrypto = Crypto.make({
  randomBytes: (size) => {
    const bytes = new Uint8Array(size);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  },
  digest: (_algorithm, data) =>
    Effect.promise(() =>
      globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(data).slice().buffer),
    ).pipe(Effect.map((digest) => new Uint8Array(digest))),
});

/** Hash canonical bytes through Effect Crypto, with a host platform fallback. */
export const sha256 = (source: string): Effect.Effect<string, InvalidDefinition> =>
  Effect.gen(function* () {
    const crypto = yield* Effect.serviceOption(Crypto.Crypto).pipe(
      Effect.map(Option.getOrElse(() => platformCrypto)),
    );
    return toHex(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(source)).pipe(
        Effect.mapError(
          (cause) =>
            new InvalidDefinition({
              subject: "manifest checksum",
              reason: `SHA-256 is unavailable or failed: ${String(cause)}`,
            }),
        ),
      ),
    );
  });
