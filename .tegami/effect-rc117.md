---
packages:
  capsuledb:
    type: minor
---

### Effect 4.0.0-rc.117

CapsuleDB builds against Effect `4.0.0-rc.117`, and the `effect`, `@effect/sql-libsql`, and
`@effect/sql-sqlite-bun` peer ranges are now `>=4.0.0-rc.117 <5`. Effect renamed the CLI flag
constructors to `Flag.Boolean` and `Flag.String`, and `0.2.0`'s `capsuledb` bin calls the old
lowercase names at import, so every subcommand crashes under Effect `rc.113` or newer. A host on a
newer Effect needs this release, and a host on an older one upgrades Effect with it.
