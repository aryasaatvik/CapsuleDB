# Contributing

CapsuleDB keeps database ownership explicit: hosts supply and retain their
Effect SQL client lifecycle, while capsules own private persistence and
forward-only migration history.

## Development

Use the Bun version pinned in `packageManager` and Node.js 24.10 or newer.
The normal tests use local databases, including disposable PostgreSQL containers;
start Docker and cache `postgres:16-alpine` before running offline:

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun run test:artifact
bun run release:check
```

`check` runs formatting, lint, source and automation types, the local release-gate
proof, and normal unit/provider/lifecycle tests. `test:artifact` builds and tests
installed packed Node/Bun CLI and Worker consumers; it installs Effect from npm
using temporary configuration and cache. `release:check` also validates metadata,
public types, docs, and built examples. `test:providers` selects provider suites;
`test:types`, `docs:check`, and `typecheck:examples` are focused gates.

Add focused tests for observable behavior and document exported contracts.
Public API changes should include the relevant type and packed-artifact proof.

## Releases

CapsuleDB uses Tegami for changelogs, versioning, and npm releases. See the
[release runbook](docs/releasing.md).

## Compatibility

The public contract is pre-1.0 and may change directly. Once a stable contract
is declared, breaking changes will be explicit and versioned.
