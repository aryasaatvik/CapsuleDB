# Provider capability matrix

Provider identity, SQL dialect, and execution capability are separate parts of
the public contract. Select the profile that matches the host client and keep the same
logical migration history across providers.

| Profile             | Dialect    | Execution     | Effect steps  | Streaming | Notes                                                                       |
| ------------------- | ---------- | ------------- | ------------- | --------- | --------------------------------------------------------------------------- |
| `SqliteBun.profile` | `sqlite`   | Transactional | Supported     | No        | Host-owned Bun SQLite client; distinct provider identity.                   |
| `Libsql.profile`    | `sqlite`   | Transactional | Supported     | No        | Host-owned libSQL client; uses SQLite dialect defaults.                     |
| `Pg.profile`        | `postgres` | Transactional | Supported     | Yes       | Host-owned PostgreSQL client; preparation serializes with an advisory lock. |
| `D1.profile`        | `sqlite`   | Atomic batch  | Not supported | No        | D1 identity with bounded atomic batches; no interactive transactions.       |

A profile's `capabilities._tag` is its execution model; there is no separate
field restating it. The table is derived from the profiles exported by
`capsuledb`:

```ts
import { Provider } from "capsuledb";

for (const profile of Provider.providerCapabilityMatrix) {
  console.log(profile.provider, profile.dialect, profile._tag);
}
```

## D1 runtime contract

D1 uses the binding's atomic `batch` primitive. CapsuleDB compiles the unique
ledger claim first and the rendered migration statements after it, then checks
the complete batch before the first mutation. Cloudflare publishes per-statement
limits for `batch` but no statement count, so the built-in profile sets its own
bound: at most 16 statements per batch, 100,000 bytes per SQL statement, and 100
bound parameters per statement. The claim occupies one slot, leaving 15 rendered
statements per runtime migration — enough for a declared table and its indexes.

D1 does not provide the transactional provider semantics used by SQLite,
libSQL, or PostgreSQL. Effect migration steps, interactive
transactions, savepoints, streaming, and multi-batch work are rejected. Keep
long-running data transformations outside this migration seam and design
small, static, bounded migrations.

## Optional static artifacts

`capsuledb d1 artifact` projects the static D1 body from a validated manifest
into an `artifact.json` index and deterministic `.sql` files. `d1 check`
rebuilds the projection and compares the manifest fingerprint, order, metadata,
and exact file contents. It rejects stale, edited, missing, reordered, and
dynamic/unsupported projections.

```sh
bun run capsuledb -- d1 artifact \
  --module ./src/capsules.ts \
  --export capsule \
  --output ./d1-artifacts
bun run capsuledb -- d1 check \
  --module ./src/capsules.ts \
  --export capsule \
  --artifact ./d1-artifacts
```

Artifacts are deterministic deployment aids, not runtime authority. They do
not contain the ledger claim, do not invoke Wrangler, and do not replace
`Registry.layer`.
