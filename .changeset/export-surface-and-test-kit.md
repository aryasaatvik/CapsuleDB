---
"capsuledb": minor
---

Prune the export surface and ship a conformance kit.

`capsuledb/Testing` exports the provider-neutral conformance suite this
repository runs against every provider, plus a `withSqlite` helper that opens a
throwaway in-memory database, so a capsule author gets a first signal without
testcontainers. `Registry.layer` and friends accept a `prefix` so two
independent registries can share one database.

Breaking: `TokenNotFound`, `TokenAlreadyConsumed`, and `InvalidToken` were
example-only errors and now live in the reference example rather than the
library's `CapsuleError` union.

`bun run docs:check` now verifies that every `capsuledb` subpath and symbol a
documentation snippet names still exists, and `tests/artifact` asserts the packed
root surface is exactly one namespace per exported subpath.
