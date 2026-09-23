# Releasing CapsuleDB

CapsuleDB uses Tegami for changelogs, versioning, npm publication, and GitHub
release tags.

## Automated releases

Add a `.tegami/*.md` changelog entry and use the Tegami PR preview before
merging. The publish workflow runs `bun run tegami ci` on every push to `main`
with npm trusted publishing and GitHub tag/release creation. It creates or
updates the `tegami/version-packages` pull request when changelogs are pending,
then publishes after that version pull request is merged.

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
