import * as Capsule from "../../src/Capsule.ts";
import * as Migration from "../../src/Migration.ts";
import * as Schema from "../../src/Schema.ts";
import { layer as tokenLayer } from "./OneTimeTokens.ts";

/**
 * The reference capsule demonstrates package-author composition. Its physical
 * tables stay private to this module and are never part of the service
 * contract, and one declaration renders on every supported dialect.
 */
const tokens = Schema.table("capsule_reference_2e_tokens", {
  columns: {
    token_hash: Schema.text(),
    expires_at: Schema.text(),
    consumed_at: Schema.text({ nullable: true }),
    consumption_id: Schema.text({ nullable: true }),
    revoked_at: Schema.text({ nullable: true }),
  },
  primaryKey: ["token_hash"],
});

const tokenAudit = Schema.table("capsule_reference_2e_token_audit", {
  columns: {
    token_hash: Schema.text(),
    consumed_at: Schema.text(),
  },
  primaryKey: ["token_hash"],
  indexes: [{ columns: ["consumed_at"] }],
});

export const capsule = Capsule.make({
  id: "reference.tokens",
  tables: [tokens, tokenAudit],
  migrations: [
    Migration.make({
      id: 1,
      name: "create-tokens",
      risk: "additive",
      steps: [Migration.createTable(tokens)],
    }),
    Migration.make({
      id: 2,
      name: "add-token-audit",
      risk: "additive",
      steps: [Migration.createTable(tokenAudit)],
    }),
  ],
  layer: tokenLayer,
});

export type { OneTimeTokens as ReferenceTokenService } from "./OneTimeTokens.ts";
