import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredDocuments = [
  "README.md",
  "docs/capsule-authors.md",
  "docs/host-applications.md",
  "docs/providers.md",
  "docs/migrations-and-recovery.md",
  "docs/adr/0001-effect-native-capsule-runtime.md",
] as const;

const repositoryRoot = resolve(import.meta.dirname, "..");
const missing = requiredDocuments.filter(
  (document) => !existsSync(resolve(repositoryRoot, document)),
);
if (missing.length > 0) {
  throw new Error(`Missing required documentation: ${missing.join(", ")}`);
}

const readme = readFileSync(resolve(repositoryRoot, "README.md"), "utf8");
for (const document of requiredDocuments.slice(1)) {
  if (!readme.includes(`(${document})`)) {
    throw new Error(`README.md does not link to ${document}`);
  }
}

const allDocumentation = requiredDocuments
  .map((document) => readFileSync(resolve(repositoryRoot, document), "utf8"))
  .join("\n");
for (const phrase of ["Samva has adopted", "Executor has adopted"]) {
  if (allDocumentation.includes(phrase)) {
    throw new Error(`Documentation must not claim external adoption: ${phrase}`);
  }
}

console.log(`Documentation check passed (${requiredDocuments.length} files).`);
