# Releasing CapsuleDB

CapsuleDB uses Tegami for changelogs, versioning, npm publication, and GitHub
release tags. The first publication bootstraps npm trusted publishing through
Tegami, then hands the actual package publication to the GitHub Actions workflow.

## Initial release

The release-prep change includes a Tegami publish lock targeting the intended
public `0.1.0` version. Before preparing a new release, validate that lock from
a clean checkout:

```sh
bun install --frozen-lockfile
bun run tegami publish --dry-run
```

For a package that is not yet on npm, authenticate and configure the trusted
publisher once:

```sh
npm login
bun run tegami npm pretrust
```

`pretrust` publishes a temporary `0.0.0-tegami-trusted-publish-setup` placeholder,
configures the `publish.yml` GitHub Actions publisher, and marks the first real
release for npm's `latest` tag. The initial lock is committed with the release
prep change. After merging it, dispatch the `Publish` workflow once:

```sh
gh workflow run Publish --repo aryasaatvik/CapsuleDB --ref main
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
