---
"capsuledb": minor
---

Checksum only the dialect body the host applies.

Manifest v2 gives every dialect body its own checksum, and the ledger records
which dialect a row's checksum is keyed to. Adding a SQLite body to a capsule
already deployed on PostgreSQL, or fixing another engine's SQL, no longer
invalidates a deployed host's ledger. `MigrationChecksumDrift` and
`LedgerConflict` name the dialect that drifted.

A ledger written by CapsuleDB 0.1 is upgraded in place on the first v2
preparation: the runtime adds the `dialect` column and re-keys each row to the
body this host applies. It still fails closed when a row's capsule, migration ID,
or name no longer matches the registered history.
