# Releasing CapsuleDB

CapsuleDB uses Tegami for changelogs, versioning, npm publication, and GitHub
release tags.

## Automated releases

Add a `.tegami/*.md` changelog entry and use the Tegami PR preview before
merging. The publish workflow runs `bun run release:publish` on every push to `main`
with npm trusted publishing and GitHub tag/release creation. It creates or
updates the `tegami/version-packages` pull request when changelogs are pending,
then publishes after that version pull request is merged.

`release:version` aliases Tegami version preparation; `release:publish` aliases
Tegami CI, retaining its existing version-PR and publication behavior. Both code
and version PRs run normal full CI.

Before publication, Tegami's `afterPreflight` hook runs `release:check`: formatting,
lint, source/automation types, normal unit/provider/lifecycle tests and the local
publication-gate proof, build and packed installed consumers, release metadata,
public types, docs, and examples. Docker is required for disposable PostgreSQL
providers; artifact consumers install Effect from npm. Run `bun run release:check`
locally to validate without preparing a version or publishing.

A failed gate stops publication and downstream tags/releases. A reviewed fix on
`main` can retry a prepared unpublished version on the next push, after all gates
pass at that commit. Reconcile registry and tags before recovering a partial
publication; never blindly republish or retag.

## Initial release

`capsuledb@0.1.0` is already published. The first publication bootstrapped npm
trusted publishing through Tegami, then handed publication to the GitHub Actions
workflow.

The release-prep change committed a Tegami publish lock for `0.1.0`. Because
the package was not yet on npm, `npm login` and `bun run tegami npm pretrust`
configured the trusted publisher once. `pretrust` published a temporary
`0.0.0-tegami-trusted-publish-setup` placeholder, configured the `publish.yml`
GitHub Actions publisher, and marked the first real release for npm's `latest`
tag. The merged `main` push published `capsuledb@0.1.0`.
