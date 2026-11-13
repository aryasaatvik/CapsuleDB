# capsuledb.arya.sh

`site/` is CapsuleDB's landing page and guides, built with [Blume](https://useblume.dev) and served
as static assets from a Cloudflare Worker. It is a standalone package with its own `bun.lock`; the
npm package never includes it (`files` publishes only `dist`, `LICENSE`, and `README.md`).

Claims follow `../.agents/marketing/`: `truth.md` decides what may be said and wins conflicts,
`positioning.md` who it is for, `voice.md` how it sounds. Visual rules are in `DESIGN.md`.

## Where content comes from

- `pages/index.astro` is the landing page.
- `content/index.mdx` and `content/quickstart.mdx` are written here.
- The guides and the changelog are **copied, not written here**. `scripts/sync.ts` runs before
  every `dev`, `build`, `check`, `validate`, and `audit`, and copies `../docs/*.md` into
  `content/(guides)/` and `content/(project)/`, `../CHANGELOG.md` into
  `content/(project)/changelog.md`, and `../media/exports/` into `public/media/`. Those outputs are
  gitignored. Edit `docs/`, `CHANGELOG.md`, or `media/`; add a guide's sidebar label and its
  110 to 160 character description to the `guides` list in `scripts/sync.ts`.

## Code samples

Never hand-write a code block that claims to be CapsuleDB usage. Put the code in `../examples/`
(which `typecheck:examples` compiles), mark a region with `// #region name` and `// #endregion`,
and render it:

```mdx
<Snippet file="examples/quick-start.ts" region="run" />
```

The landing page calls `snippet()` from `components/snippets.ts` directly. `examples/quick-start.ts`
also runs in `tests/artifact/quick-start.test.ts`, so the quick start is executed, not only
typechecked.

## Checks

From this directory:

```sh
bun install --frozen-lockfile
bun run build
bun run validate   # blume validate --strict: broken links
bun run audit      # blume audit --strict: titles, descriptions, inbound links, contrast
```

`audit --strict` fails on warnings: a page needs a 110 to 160 character `description`, a rendered
title of 60 columns or fewer, and at least one link from another page's body. CI runs all three
plus `wrangler deploy --dry-run`.

## Deploy

`wrangler.jsonc` serves `dist/` as Workers static assets on the `capsuledb.arya.sh` custom domain.
`bun run deploy` builds and runs `wrangler deploy`.

This site uses Wrangler, not Cloudflare's `cf` CLI: `cf` is in beta and cannot build Astro 6 or
newer, which Blume is built on. Move it to `cf` together with domain-kit.dev once `cf` supports
Astro.
