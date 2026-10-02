---
packages:
  capsuledb:
    type: minor
---

### Stable Effect 4

**Breaking:** CapsuleDB now requires stable Effect 4 (`>=4.0.0 <5`) and stable Effect SQL
drivers with the same version range. Update your application's Effect and SQL
driver dependencies together before upgrading; Effect 4 release candidates are
no longer supported. SQL imports use `effect/sql/*` and CLI imports use
`effect/cli`.

The optional `capsuledb/alchemy` integration now requires Alchemy
`>=2.0.0-beta.80 <3` and `@effect/sql-pg` `>=4.0.0 <5`. Alchemy beta80 supports
stable Effect module paths, so deploy-time PostgreSQL registry preparation works
with the stable dependencies. CapsuleDB's public entrypoints remain available.
