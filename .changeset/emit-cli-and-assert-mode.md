---
"capsuledb": minor
---

Emit capsule SQL into a host's migration folder and assert readiness at boot.

`capsuledb emit --module --export --dialect postgres|sqlite --out <dir>` writes
the ledger DDL, one file per migration with its ledger row, and the readiness
metadata row. `capsuledb check` verifies that folder still matches the installed
library. `Registry.layer({ mode: "assert" })` then applies nothing and fails with
`NotReady` unless the database already matches the registered history.

Files are numbered by CapsuleDB's own migration order rather than by wall clock,
so the projection is byte-for-byte reproducible and `check` can compare it
directly. `--provider` stamps a non-default SQLite provider identity and
`--prefix` matches a prefixed registry.
