import { PostgresProfile } from "./Provider.ts";

/**
 * Provider metadata for a host-supplied Effect PostgreSQL client.
 * CapsuleDB does not create, replace, or close the host pool or client.
 */
export const profile = PostgresProfile;
