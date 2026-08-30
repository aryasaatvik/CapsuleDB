import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    Capsule: "src/Capsule.ts",
    Error: "src/Error.ts",
    index: "src/index.ts",
    Migration: "src/Migration.ts",
    Libsql: "src/Libsql.ts",
    Manifest: "src/Manifest.ts",
    Pg: "src/Pg.ts",
    Provider: "src/Provider.ts",
    Readiness: "src/Readiness.ts",
    Registry: "src/Registry.ts",
    SqliteBun: "src/SqliteBun.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
