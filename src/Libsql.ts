import { LibsqlProfile } from "./Provider.ts";

/**
 * Provider metadata for a host-supplied Effect SQL client backed by libSQL.
 * CapsuleDB does not create, replace, or close the libSQL client.
 */
export const Libsql = Object.freeze({
  profile: LibsqlProfile,
});
