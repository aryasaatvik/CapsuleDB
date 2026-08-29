import { Effect } from "effect";

import { InvalidDefinition } from "../Error.ts";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Hash authored source bytes with the runtime's standard Web Crypto surface. */
export const sha256 = (source: string): Effect.Effect<string, InvalidDefinition> =>
  Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    catch: (cause) =>
      new InvalidDefinition({
        subject: "manifest checksum",
        reason: `SHA-256 is unavailable or failed: ${String(cause)}`,
      }),
  }).pipe(Effect.map((digest) => toHex(new Uint8Array(digest))));
