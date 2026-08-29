# Contributing

CapsuleDB keeps database ownership explicit: hosts supply and retain their
Effect SQL client lifecycle, while capsules own private persistence and
forward-only migration history.

## Development

Use Bun 1.4 and Node.js 24.10 or newer:

```sh
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
```

Add focused tests for observable behavior and document exported contracts.
Public API changes should include the relevant type and packed-artifact proof.

## Compatibility

The public contract is pre-1.0 and may change directly. Once a stable contract
is declared, breaking changes will be explicit and versioned.
