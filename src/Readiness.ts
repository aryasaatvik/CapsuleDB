import { Effect, Schema } from "effect";

import { NotReady } from "./Error.ts";

/** Readiness state exposed by registry preparation and cheap fast paths. */
export const Readiness = Schema.TaggedUnion({
  Pending: {
    fingerprint: Schema.String,
  },
  Ready: {
    fingerprint: Schema.String,
    provider: Schema.String,
  },
  Stale: {
    expectedFingerprint: Schema.String,
    actualFingerprint: Schema.String,
  },
});

export type Readiness = typeof Readiness.Type;

/** A successful preparation receipt suitable for a host readiness cache. */
export const ReadinessReceipt = Schema.Struct({
  _tag: Schema.Literal("Ready"),
  fingerprint: Schema.String,
  provider: Schema.String,
  capsuleCount: Schema.Int,
});

export type ReadinessReceipt = typeof ReadinessReceipt.Type;

/** Build a stable receipt without exposing provider rows or client state. */
export const makeReadinessReceipt = (
  fingerprint: string,
  provider: string,
  capsuleCount: number,
): ReadinessReceipt =>
  Schema.decodeUnknownSync(ReadinessReceipt)({
    _tag: "Ready",
    fingerprint,
    provider,
    capsuleCount,
  });

/** Assert that a persisted fingerprint matches the current registry. */
export const assertReady = (
  expectedFingerprint: string,
  actualFingerprint: string,
): Effect.Effect<true, NotReady> =>
  expectedFingerprint === actualFingerprint
    ? Effect.succeed(true)
    : Effect.fail(new NotReady({ expectedFingerprint, actualFingerprint }));
