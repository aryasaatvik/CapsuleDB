import packageJson from "../package.json" with { type: "json" };

/** The current CapsuleDB package version from the package manifest. */
export const VERSION = packageJson.version;

export * from "./Capsule.ts";
export * as D1 from "./D1.ts";
export * from "./D1Artifact.ts";
export * from "./Error.ts";
export * from "./Migration.ts";
export * from "./Manifest.ts";
export * as Libsql from "./Libsql.ts";
export * as Pg from "./Pg.ts";
export * from "./Provider.ts";
export * from "./Readiness.ts";
export * from "./Registry.ts";
export * as SqliteBun from "./SqliteBun.ts";

export * as CapsuleModule from "./Capsule.ts";
export * as D1ArtifactModule from "./D1Artifact.ts";
export * as ErrorModule from "./Error.ts";
export * as MigrationModule from "./Migration.ts";
export * as ManifestModule from "./Manifest.ts";
export * as ProviderModule from "./Provider.ts";
export * as ReadinessModule from "./Readiness.ts";
export * as RegistryModule from "./Registry.ts";
