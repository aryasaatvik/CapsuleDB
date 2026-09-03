import packageJson from "../package.json" with { type: "json" };

/** The current CapsuleDB package version from the package manifest. */
export const VERSION = packageJson.version;

export * as Capsule from "./Capsule.ts";
export * as D1 from "./D1.ts";
export * as D1Artifact from "./D1Artifact.ts";
export * as Error from "./Error.ts";
export * as Libsql from "./Libsql.ts";
export * as Manifest from "./Manifest.ts";
export * as Migration from "./Migration.ts";
export * as Pg from "./Pg.ts";
export * as Provider from "./Provider.ts";
export * as Readiness from "./Readiness.ts";
export * as Registry from "./Registry.ts";
export * as SqliteBun from "./SqliteBun.ts";
