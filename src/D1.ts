import { D1Profile } from "./Provider.ts";

/**
 * Provider metadata for a host-supplied Cloudflare D1 client. CapsuleDB uses
 * D1's bounded atomic batch primitive and never creates, closes, or replaces
 * the host-owned binding.
 */
export const profile = D1Profile;
