import packageJson from "../package.json" with { type: "json" };

/** The current CapsuleDB package version from the package manifest. */
export const VERSION = packageJson.version;
