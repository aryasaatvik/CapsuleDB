import { Effect, Layer, Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { InvalidCapsuleId, InvalidNamespace } from "./Error.ts";
import type { Migration } from "./Migration.ts";

const CAPSULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/** A validated, stable logical capsule identifier. */
export const CapsuleId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(96), Schema.isPattern(CAPSULE_ID_PATTERN)),
  Schema.brand("CapsuleId"),
);

export type CapsuleId = typeof CapsuleId.Type;

/** A validated physical namespace derived only from a capsule identifier. */
export const CapsuleNamespace = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(512),
    Schema.isPattern(/^capsule_[a-z0-9_]+$/),
  ),
  Schema.brand("CapsuleNamespace"),
);

export type CapsuleNamespace = typeof CapsuleNamespace.Type;

const encodeNamespacePart = (id: string): string => {
  let output = "capsule_";
  for (const character of id) {
    if (/^[a-z0-9]$/.test(character)) {
      output += character;
    } else {
      output += `_${character.charCodeAt(0).toString(16)}_`;
    }
  }
  return output;
};

/** Derive a deterministic physical namespace without accepting host renames. */
export const deriveNamespace = (id: CapsuleId): CapsuleNamespace =>
  Schema.decodeUnknownSync(CapsuleNamespace)(encodeNamespacePart(id));

/** A capsule's immutable definition and package-author service layer. */
export interface Capsule<Service, Failure = never, Requirements = SqlClient.SqlClient> {
  readonly id: CapsuleId;
  readonly namespace: CapsuleNamespace;
  readonly migrations: ReadonlyArray<Migration>;
  readonly layer: Layer.Layer<Service, Failure, Requirements>;
}

/** Inputs accepted at the definition boundary. The identifier is parsed here. */
export interface CapsuleOptions<Service, Failure = never, Requirements = SqlClient.SqlClient> {
  readonly id: unknown;
  readonly migrations: ReadonlyArray<Migration>;
  readonly layer: Layer.Layer<Service, Failure, Requirements>;
}

/** Errors raised while parsing a capsule's identity or immutable definition. */
export type CapsuleDefinitionError = InvalidCapsuleId | InvalidNamespace;

/** Construct an immutable capsule after validating its identity. */
export const makeCapsule = <Service, Failure = never, Requirements = SqlClient.SqlClient>(
  options: CapsuleOptions<Service, Failure, Requirements>,
): Effect.Effect<Capsule<Service, Failure, Requirements>, CapsuleDefinitionError> =>
  Effect.gen(function* () {
    const id = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(CapsuleId)(options.id),
      catch: (cause) =>
        new InvalidCapsuleId({
          value: String(options.id),
          reason: String(cause),
        }),
    });

    const namespace = yield* Effect.try({
      try: () => deriveNamespace(id),
      catch: (cause) =>
        new InvalidNamespace({
          value: String(cause),
          reason: "The deterministic namespace derivation produced an invalid value",
        }),
    });

    return Object.freeze({
      id,
      namespace,
      migrations: Object.freeze([...options.migrations]),
      layer: options.layer,
    });
  });
