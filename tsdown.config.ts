import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    Capsule: "src/Capsule.ts",
    D1: "src/D1.ts",
    D1Artifact: "src/D1Artifact.ts",
    Dialect: "src/Dialect.ts",
    Error: "src/Error.ts",
    index: "src/index.ts",
    Migration: "src/Migration.ts",
    Libsql: "src/Libsql.ts",
    Manifest: "src/Manifest.ts",
    Pg: "src/Pg.ts",
    Provider: "src/Provider.ts",
    Readiness: "src/Readiness.ts",
    Registry: "src/Registry.ts",
    Schema: "src/Schema.ts",
    SqliteBun: "src/SqliteBun.ts",
    Testing: "src/Testing.ts",
    cli: "src/cli.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
