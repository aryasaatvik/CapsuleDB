import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    Capsule: "src/Capsule.ts",
    Error: "src/Error.ts",
    index: "src/index.ts",
    Migration: "src/Migration.ts",
    Manifest: "src/Manifest.ts",
    Provider: "src/Provider.ts",
    Readiness: "src/Readiness.ts",
    Registry: "src/Registry.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
