# Releasing CapsuleDB

CapsuleDB uses Tegami for changelogs, versioning, npm publication, and GitHub
release tags. The first npm publication is intentionally manual so the package
name, provenance, and initial `0.1.0` contract can be confirmed before enabling
automatic releases.

## Initial release

From the exact release commit:

```sh
bun install --frozen-lockfile
bun run release:check
bun publish --access public --provenance
```

After confirming `capsuledb@0.1.0` is available from npm, change
`.github/workflows/publish.yml` to trigger on pushes to `main`. Subsequent
changes should add a `.tegami/*.md` changelog entry and use the Tegami PR
preview before merging.

## Automated releases

The publish workflow runs `bun run tegami ci` with npm trusted publishing and
GitHub tag/release creation. It is currently `workflow_dispatch`-only by
design; enabling the `main` push trigger is a deliberate post-initial-release
step.
