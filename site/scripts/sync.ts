/**
 * Copies the repository's sources of truth into the site before every build, so the site never
 * keeps a second copy that can drift:
 *
 * - each guide in `docs/` becomes a page under `content/(guides)/` or `content/(project)/` (its H1 becomes the title, and links to
 *   sibling guides or examples are rewritten for the site);
 * - `CHANGELOG.md` becomes `content/(project)/changelog.md`;
 * - the launch film, poster, infographics and cards in `media/exports/` are copied to `public/media/`.
 *
 * Every output is gitignored. Edit the source, not the copy.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const site = resolve(import.meta.dirname, "..");
const repository = resolve(site, "..");
const githubBlob = "https://github.com/aryasaatvik/CapsuleDB/blob/main";

export interface Guide {
  /** Route segment under `/docs`, and the file name in `content/`. */
  readonly slug: string;
  /** File under the repository's `docs/`. */
  readonly source: string;
  /** Sidebar label; the page title comes from the guide's H1. */
  readonly label: string;
  /** Meta description: 110 to 160 characters, checked below. */
  readonly description: string;
  /** Sidebar group folder under `content/`; parenthesized, so it adds no URL segment. */
  readonly group: "(guides)" | "(project)";
}

export const guides: ReadonlyArray<Guide> = [
  {
    slug: "capsule-authors",
    source: "capsule-authors.md",
    label: "Capsule authors",
    group: "(guides)",
    description:
      "Define a CapsuleDB capsule: a stable ID, tables declared once, append-only migrations, and an opaque Effect service the host composes.",
  },
  {
    slug: "host-applications",
    source: "host-applications.md",
    label: "Host applications",
    group: "(guides)",
    description:
      "Compose capsules over the client your app already owns: preparation, readiness checks, deploy-time preparation, and destructive authorization.",
  },
  {
    slug: "providers",
    source: "providers.md",
    label: "Providers",
    group: "(guides)",
    description:
      "The provider profiles CapsuleDB supports (PostgreSQL, Bun SQLite, libSQL and Cloudflare D1) and the bounded atomic-batch contract D1 runs under.",
  },
  {
    slug: "migrations-and-recovery",
    source: "migrations-and-recovery.md",
    label: "Migrations and recovery",
    group: "(guides)",
    description:
      "How CapsuleDB migration history changes over time, what each startup state means, and how to recover from drift, failed preparation or removal.",
  },
  {
    slug: "design",
    source: "design.md",
    label: "Design principles",
    group: "(guides)",
    description:
      "The principles behind CapsuleDB: the host's SqlClient is the seam, a capsule is a value, identity is derived, and what the library refuses to do.",
  },
  {
    slug: "releasing",
    source: "releasing.md",
    label: "Releasing",
    group: "(project)",
    description:
      "How CapsuleDB is versioned and published: Tegami changelog entries, the version pull request, npm trusted publishing and the gates before release.",
  },
];

const guideSlugs = new Map(guides.map((guide) => [guide.source, guide.slug]));

const yamlString = (value: string): string => JSON.stringify(value);

/** Rewrite repository-relative links in a guide to their site or GitHub equivalents. */
export const rewriteLinks = (markdown: string): string =>
  markdown.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) => {
    if (/^(?:[a-z]+:|#|\/)/.test(target)) return whole;
    const [path = "", hash] = target.split("#");
    const anchor = hash === undefined ? "" : `#${hash}`;
    const slug = guideSlugs.get(path.replace(/^\.\//, ""));
    if (slug !== undefined) return `](/docs/${slug}${anchor})`;
    if (path.startsWith("../")) return `](${githubBlob}/${path.slice(3)}${anchor})`;
    throw new Error(`Unmapped link ${target}: add it to scripts/sync.ts`);
  });

/** Split a guide into its H1 title and the body after it. */
export const splitTitle = (markdown: string): { readonly title: string; readonly body: string } => {
  const match = /^# (.+)\n+/.exec(markdown);
  if (match?.[1] === undefined) throw new Error("A guide must start with an H1 title");
  return { title: match[1].trim(), body: markdown.slice(match[0].length) };
};

const page = (frontmatter: Record<string, string>, body: string): string =>
  `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n\n${body.trimEnd()}\n`;

const syncGuides = (): void => {
  for (const guide of guides) {
    if (guide.description.length < 110 || guide.description.length > 160) {
      throw new Error(`${guide.slug}: description is ${guide.description.length} characters`);
    }
    const { title, body } = splitTitle(
      readFileSync(join(repository, "docs", guide.source), "utf8"),
    );
    const frontmatter = {
      title: yamlString(title),
      description: yamlString(guide.description),
      sidebar: `\n  label: ${yamlString(guide.label)}`,
    };
    const directory = join(site, "content", guide.group);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${guide.slug}.md`), page(frontmatter, rewriteLinks(body)));
  }
};

const syncChangelog = (): void => {
  const changelog = readFileSync(join(repository, "CHANGELOG.md"), "utf8");
  const frontmatter = {
    title: yamlString("Changelog"),
    description: yamlString(
      "Every published CapsuleDB release, newest first, with its breaking changes and the Effect and SQL driver versions it requires.",
    ),
  };
  mkdirSync(join(site, "content", "(project)"), { recursive: true });
  writeFileSync(
    join(site, "content", "(project)", "changelog.md"),
    page(frontmatter, rewriteLinks(changelog)),
  );
};

const syncMedia = (): void => {
  const from = join(repository, "media", "exports");
  const to = join(site, "public", "media");
  mkdirSync(to, { recursive: true });
  for (const file of readdirSync(from)) copyFileSync(join(from, file), join(to, file));
};

if (import.meta.main) {
  syncGuides();
  syncChangelog();
  syncMedia();
}
