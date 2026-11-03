import { Cause, Effect, Option } from "effect";
import { Digest } from "effect/crypto";

import { InvalidDefinition } from "../Error.ts";

/** Hash canonical bytes with Digest, or WebCrypto when the caller did not provide one. */
export const sha256 = (source: string): Effect.Effect<string, InvalidDefinition> =>
  Effect.gen(function* () {
    const provided = yield* Effect.serviceOption(Digest.Digest);
    const digest = yield* Option.match(provided, {
      onNone: () => Digest.Digest.pipe(Effect.provide(Digest.layerWebCrypto)),
      onSome: (service) => Effect.succeed(service),
    });
    return yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(source));
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.fail(
            new InvalidDefinition({
              subject: "manifest checksum",
              reason: `SHA-256 is unavailable or failed: ${String(cause)}`,
            }),
          ),
    ),
  );
