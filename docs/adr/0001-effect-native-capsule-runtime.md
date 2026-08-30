# ADR 0001: Effect-native capsule runtime

- Status: accepted
- Date: 2026-08-30

## Context

CapsuleDB needs one durable definition for a capsule's identity, logical
migration history, provider requirements, and domain service. The host owns a
database connection and its lifetime. CapsuleDB coordinates preparation and
provides the capsule's domain layer; it is not an ORM and must not become a
second query or connection-lifecycle API.

The local Effect SQL precedent is the `SqlClient` service and `Layer` graph in
`/Users/aryasaatvik/Developer/effect/ai-docs/src/40_sql/10_basics.ts` and
`/Users/aryasaatvik/Developer/effect/packages/effect/src/unstable/sql/SqlClient.ts`.
Those APIs keep the client as an Effect environment while drivers own opening
and closing resources.

## Options considered

### A. Descriptor-only capsule

```ts
type Capsule = {
  readonly id: CapsuleId;
  readonly migrations: ReadonlyArray<Migration>;
  readonly service: (client: SqlClient.SqlClient) => Effect.Effect<unknown>;
};
```

This makes discovery easy, but it turns service composition into an ad-hoc
function convention. The service's provided context, typed failures, and
additional Effect dependencies are erased at the package boundary. It also
encourages callers to pass a client directly and makes it too easy to confuse
the host's lifecycle with CapsuleDB's work.

### B. Descriptor plus Effect `Layer` (selected)

```ts
type Capsule<Service, Failure, Requirements = SqlClient.SqlClient> = {
  readonly id: CapsuleId;
  readonly namespace: CapsuleNamespace;
  readonly migrations: ReadonlyArray<Migration>;
  readonly layer: Layer.Layer<Service, Failure, Requirements>;
};
```

This keeps the host-supplied `SqlClient` visible as the real framework seam,
preserves typed service failures and environments, and lets the caller compose
the domain layer with normal Effect operations. CapsuleDB may prepare the
database before building this layer without taking ownership of the client.

## Decision

Use option B. Capsule definitions are immutable values with a branded logical
ID, a deterministic package-owned physical namespace, append-only migration
descriptors, and an Effect `Layer` for the opaque domain service. A registry is
explicitly composed from capsules and one validated provider profile before
any database mutation.

Provider dialect and execution capabilities remain separate tagged models. The
D1 profile is atomic-batch-only: it cannot advertise interactive transactions,
savepoints, streaming, or arbitrary Effect migration bodies. Transactional
providers may opt into Effect migration bodies restricted to the host
`SqlClient` environment; their source text is still provided explicitly for
manifest hashing and functions are never serialized.

CapsuleDB owns migration coordination and ledger state. A capsule owns its
private queries and service implementation. The host supplies and owns the
`SqlClient` lifecycle. No public module exports tables, rows, query builders,
raw driver clients, connection constructors, or Promise-based alternatives.

CapsuleDB guarantees deterministic namespace derivation, collision rejection,
opaque package-owned APIs, and registry composition. It does not parse or
sandbox package-authored raw SQL or service-layer code. Package authors are
trusted in v0.1 and remain responsible for avoiding cross-capsule physical
composition; hosts should treat package migration and service code as trusted.

The manifest CLI is an explicit build-time projection of those same definitions:
it accepts a named module export, delegates manifest generation and validation
to the canonical operations, and never scans dependencies. Optional D1 files
are generated only from static D1 bodies already represented in a validated
manifest. They are deterministic deployment aids and do not replace
`Registry.prepare`, which remains responsible for the claim-first ledger and
readiness contract.

## Consequences

- Capsule authors can persist and check a reproducible fingerprint without
  exposing physical tables or giving the host an implicit discovery mechanism.
- Hosts can run `prepare` against their existing client and gate service
  exposure on a complete readiness receipt.
- D1 gets a bounded static artifact path for tooling while retaining one
  canonical runtime path; Wrangler and account configuration remain outside
  this package.
- A packed release candidate can be tested through the package export map and
  CLI bin without making publication or repository visibility part of the
  runtime contract.

## Rejected alternatives

- **ORM/table-first API:** would make persistence details the public contract
  and erase capsule ownership boundaries.
- **External-only D1 preparation:** would leave the same migration and
  readiness semantics untested across providers; D1 gets its own explicit
  bounded atomic-batch profile instead.
- **Host namespace/table renaming:** would make physical identity mutable and
  undermine collision detection and manifest fingerprints.
- **Implicit module/dependency discovery:** would make the release output
  depend on installation topology and obscure which package definitions a host
  trusts; the CLI requires an explicit module and export instead.
- **Artifact-as-runtime authority:** would bypass the claim ledger and
  readiness checks; static D1 files remain optional projections only.
