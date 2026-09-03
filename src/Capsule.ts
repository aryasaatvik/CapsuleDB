import { Schema } from "effect";
import type * as Layer from "effect/Layer";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { CapsuleDefinitionError } from "./Error.ts";
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

/**
 * Derive a deterministic physical namespace without accepting host renames.
 *
 * The encoding is injective, so two distinct capsule identifiers can never
 * produce the same namespace.
 */
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
export interface Options<Service, Failure = never, Requirements = SqlClient.SqlClient> {
  readonly id: string;
  readonly migrations: ReadonlyArray<Migration>;
  readonly layer: Layer.Layer<Service, Failure, Requirements>;
}

/**
 * Construct an immutable capsule after validating its identity.
 *
 * This constructor is pure and has `makeUnsafe` semantics: it returns the
 * capsule directly and throws {@link CapsuleDefinitionError} on an invalid
 * definition. A capsule is therefore a module-level constant, and a host never
 * has to run an Effect before it can compose one.
 */
export const make = <Service, Failure = never, Requirements = SqlClient.SqlClient>(
  options: Options<Service, Failure, Requirements>,
): Capsule<Service, Failure, Requirements> => {
  let id: CapsuleId;
  try {
    id = Schema.decodeUnknownSync(CapsuleId)(options.id);
  } catch (cause) {
    throw new CapsuleDefinitionError({
      subject: `capsule ${JSON.stringify(options.id)}`,
      reason: String(cause),
    });
  }

  return Object.freeze({
    id,
    namespace: deriveNamespace(id),
    migrations: Object.freeze([...options.migrations]),
    layer: options.layer,
  });
};
