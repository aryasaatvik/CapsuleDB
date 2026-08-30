import packageJson from "../package.json" with { type: "json" };

/** The current CapsuleDB package version from the package manifest. */
export const VERSION = packageJson.version;

export * from "./Capsule.ts";
export * from "./D1.ts";
export * from "./D1Artifact.ts";
export * from "./Error.ts";
export * from "./Migration.ts";
export * from "./Manifest.ts";
export * from "./Libsql.ts";
export * from "./Pg.ts";
export * from "./Provider.ts";
export * from "./Readiness.ts";
export * from "./Registry.ts";
export * from "./SqliteBun.ts";
