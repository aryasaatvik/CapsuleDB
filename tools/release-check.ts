import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import packageJson from "../package.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "dist/index.mjs",
  "dist/index.d.mts",
  "dist/cli.mjs",
  "dist/D1Artifact.mjs",
  "dist/D1Artifact.d.mts",
  "README.md",
  "LICENSE",
] as const;

if (packageJson.name !== "capsuledb") throw new Error("package name must remain capsuledb");
if (
  typeof packageJson.version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(packageJson.version)
) {
  throw new Error("package version must be valid semantic version");
}
if (packageJson.license !== "MIT") throw new Error("release candidate must remain MIT licensed");
if (packageJson.author !== "Saatvik Arya") throw new Error("package author changed unexpectedly");
if (packageJson.bin?.capsuledb !== "./dist/cli.mjs") {
  throw new Error("capsuledb bin must point at the packed CLI");
}
if (packageJson.peerDependencies?.effect !== ">=4.0.0-rc.111 <5") {
  throw new Error("Effect peer range is not the verified v4 range");
}

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) throw new Error(`missing release file: ${file}`);
}

const changesets = readdirSync(resolve(root, ".changeset")).filter(
  (file) => file.endsWith(".md") && file !== "README.md",
);
if (changesets.length === 0) throw new Error("release candidate has no changeset");

const packageText = readFileSync(resolve(root, "package.json"), "utf8");
if (!packageText.includes('"files"')) throw new Error("package files allowlist is missing");

console.log(
  `Release metadata check passed (${packageJson.name}@${packageJson.version}, ${changesets.length} changeset).`,
);
