# Provider capability matrix

Provider dialect and execution capability are separate parts of the public
contract. Select the profile that matches the host client and keep the same
logical migration history across providers.

| Profile             | Dialect    | Execution     | Effect bodies | Streaming | Notes                                                                       |
| ------------------- | ---------- | ------------- | ------------- | --------- | --------------------------------------------------------------------------- |
| `SqliteBun.profile` | SQLite     | Transactional | Supported     | No        | Host-owned Bun SQLite client.                                               |
| `Libsql.profile`    | libSQL     | Transactional | Supported     | No        | Host-owned libSQL client.                                                   |
| `Pg.profile`        | PostgreSQL | Transactional | Supported     | Yes       | Host-owned PostgreSQL client; preparation serializes with an advisory lock. |
| `D1.profile`        | D1         | Atomic batch  | Not supported | No        | No interactive transactions, savepoints, or streams.                        |

The table is derived from the profiles exported by `capsuledb`:

```ts
import { providerCapabilityMatrix } from "capsuledb";

for (const profile of providerCapabilityMatrix) {
  console.log(profile.dialect, profile._tag);
}
```

## D1 runtime contract

D1 uses the binding's atomic `batch` primitive. CapsuleDB compiles the unique
ledger claim first and the static migration statements after it, then checks
the complete batch before the first mutation. The built-in profile currently
allows at most two statements per batch, 100,000 bytes per SQL statement, and
100 bound parameters per statement. In practice this leaves one authored SQL
statement per runtime migration because the claim occupies the other slot.

D1 does not provide the transactional provider semantics used by SQLite,
libSQL, or PostgreSQL. Dynamic Effect migration bodies, interactive
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
`Registry.prepare`.
