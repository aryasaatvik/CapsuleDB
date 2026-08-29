# CapsuleDB

CapsuleDB is an Effect-native library for packages that own private database
tables, typed persistence operations, and forward migrations inside a host
application's database.

The host supplies the Effect SQL client and owns its connection lifecycle.
CapsuleDB keeps the capsule's physical schema and persistence implementation
private, while exposing explicit preparation and domain-oriented services.

## Status

The package is in active pre-1.0 development. The public contract is Effect 4
and may change directly until a stable release is declared.

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

## Scope

CapsuleDB is not an ORM. It does not expose package-owned tables, rows, query
builders, raw driver ownership, or a Promise facade as its canonical API.

## License

MIT
