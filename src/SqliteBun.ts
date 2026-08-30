import { BunSqliteProfile } from "./Provider.ts";

/**
 * Provider metadata for a host-supplied Effect SQL client backed by Bun
 * SQLite. CapsuleDB does not open, close, or otherwise own that client.
 */
export const profile = BunSqliteProfile;
