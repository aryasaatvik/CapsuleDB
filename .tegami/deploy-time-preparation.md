---
packages:
  capsuledb:
    type: minor
---

### A current registry answers in one round trip

`Registry.prepare`, `Registry.assert`, and `Registry.status` read readiness metadata and the whole
ledger in one statement. When the recorded fingerprint matches and the ledger is complete,
`prepare` returns `Ready` from that read alone: no transaction, no PostgreSQL advisory lock, and no
`CREATE TABLE IF NOT EXISTS`. Anything else — missing tables, a new migration, a ledger that still
needs re-keying — takes the locked preparation path unchanged. Inside a caller's transaction the
read runs under a savepoint, so an empty PostgreSQL database cannot abort that transaction.
