---
"capsuledb": minor
---

Make capsule definitions pure values and boot every capsule from one Layer.

`Capsule.make` and `Migration.make` now return the value and throw
`CapsuleDefinitionError` on an invalid definition, so a capsule is a module
constant instead of an Effect a host has to run first. `Registry.layer(options)`
prepares pending migrations and then provides every registered capsule's
service with its merged service, failure, and requirement types.

Breaking: the root export is namespace-only (`Capsule`, `Migration`, `Registry`,
...); `makeCapsule`, `makeMigration`, `sqlMigrationBody`, `effectMigrationBody`,
`makeRegistry`, `describe`, `migrationsOf`, and `assertRegistryReady` are gone.
`RegistryPlanState`, `Readiness`, and `ReadinessReceipt` collapse into one
`Readiness` union of `Ready`, `Pending`, and `Drift`.
