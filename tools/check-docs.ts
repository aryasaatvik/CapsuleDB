import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import packageJson from "../package.json" with { type: "json" };

const requiredDocuments = [
  "README.md",
  "docs/capsule-authors.md",
  "docs/host-applications.md",
  "docs/providers.md",
  "docs/migrations-and-recovery.md",
  "docs/design.md",
] as const;

const repositoryRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(repositoryRoot, path), "utf8");

const missing = requiredDocuments.filter(
  (document) => !existsSync(resolve(repositoryRoot, document)),
);
if (missing.length > 0) {
  throw new Error(`Missing required documentation: ${missing.join(", ")}`);
}

const readme = read("README.md");
for (const document of requiredDocuments.slice(1)) {
  if (!readme.includes(`(${document})`)) {
    throw new Error(`README.md does not link to ${document}`);
  }
}

const allDocumentation = requiredDocuments.map(read).join("\n");
for (const phrase of ["Samva has adopted", "Executor has adopted"]) {
  if (allDocumentation.includes(phrase)) {
    throw new Error(`Documentation must not claim external adoption: ${phrase}`);
  }
}

/**
 * Check that every `capsuledb` symbol a snippet names still exists.
 *
 * Snippets are illustrative and do not compile on their own, so this checks
 * identity rather than types: the subpath is exported, the module exists, and
 * every `Namespace.member` the snippet calls is exported by that module. That
 * is the drift class docs actually suffer — a renamed or deleted export.
 */
const exportedNames = (module: string): ReadonlySet<string> => {
  const source = read(`src/${module}.ts`);
  const names = new Set<string>();
  for (const match of source.matchAll(
    /^export (?:declare )?(?:const|let|function|class|type|interface|enum) (\w+)/gm,
  )) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  for (const match of source.matchAll(/^export \* as (\w+) from/gm)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  for (const match of source.matchAll(/^export \{([^}]*)\}/gm)) {
    for (const name of match[1]?.split(",") ?? []) {
      const trimmed = name
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (trimmed !== undefined && trimmed.length > 0) names.add(trimmed);
    }
  }
  return names;
};

const rootExports = exportedNames("index");
const problems: Array<string> = [];

for (const document of requiredDocuments) {
  const source = read(document);
  for (const block of source.matchAll(/```ts\n([\s\S]*?)```/g)) {
    const snippet = block[1] ?? "";
    for (const statement of snippet.matchAll(
      /import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+"capsuledb(\/[\w.]+)?"/g,
    )) {
      const subpath = statement[3] === undefined ? "." : `.${statement[3]}`;
      if (!(subpath in packageJson.exports)) {
        problems.push(`${document}: "capsuledb${statement[3] ?? ""}" is not an exported subpath`);
        continue;
      }
      const module = subpath === "." ? "index" : subpath.slice(2);
      const available = exportedNames(module);
      const imported = (statement[2] ?? statement[1] ?? "")
        .split(",")
        .map(
          (name) =>
            name
              .replace(/^type\s+/, "")
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim() ?? "",
        )
        .filter((name) => name.length > 0);

      for (const name of imported) {
        if (!available.has(name)) {
          problems.push(`${document}: "capsuledb${statement[3] ?? ""}" does not export ${name}`);
          continue;
        }
        // A root-level namespace import: check the members the snippet uses.
        if (module !== "index" || !rootExports.has(name)) continue;
        const members = exportedNames(name);
        for (const usage of snippet.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, "g"))) {
          const member = usage[1];
          if (member !== undefined && !members.has(member)) {
            problems.push(`${document}: ${name}.${member} does not exist`);
          }
        }
      }
    }
  }
}

if (problems.length > 0) {
  throw new Error(`Documentation references stale API:\n  ${[...new Set(problems)].join("\n  ")}`);
}

console.log(
  `Documentation check passed (${requiredDocuments.length} files, public API references verified).`,
);
