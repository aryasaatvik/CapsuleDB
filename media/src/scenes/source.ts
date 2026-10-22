/**
 * Code shown on screen. Each excerpt is copied verbatim from the repository file it names, and
 * `tests/source.test.ts` fails when that file no longer contains it. The usage sequence is the
 * one illustrative excerpt; the test checks its operations against the reference service instead.
 */

export interface Excerpt {
  readonly file: string;
  readonly code: string;
}

export const capsuleDefinition: Excerpt = {
  file: "examples/reference-token/Capsule.ts",
  code: `export const capsule = Capsule.make({
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
});`,
};

export const hostComposition: Excerpt = {
  file: "docs/host-applications.md",
  code: `import { Pg, Registry } from "capsuledb";
import { capsule } from "./capsule.js";

export const CapsulesLive = Registry.layer({
  provider: Pg.profile,
  capsules: [capsule],
});

const application = Effect.service(CapsuleService).pipe(
  Effect.provide(CapsulesLive),
  Effect.provideService(SqlClient.SqlClient, hostOwnedSqlClient),
);`,
};

export const deferredReadiness: Excerpt = {
  file: "docs/host-applications.md",
  code: `Registry.layer({
  provider: Pg.profile,
  capsules: [capsule],
  mode: "assert",
  readiness: "first-use",
});`,
};

/** Illustrative calls against the reference service; each line's result is shown beside it. */
export const tokenUsage = {
  file: "examples/reference-token/OneTimeTokens.ts",
  lines: [
    { code: "const tokens = yield* OneTimeTokens;", result: undefined },
    {
      code: "const { token } = yield* tokens.issue(expiresAt);",
      result: { tone: "code", text: "IssuedToken" },
    },
    { code: "yield* tokens.get(token);", result: { tone: "pending", text: "Pending" } },
    { code: "yield* tokens.consume(token);", result: { tone: "ready", text: "AuditReceipt" } },
    {
      code: "yield* tokens.consume(token);",
      result: { tone: "seal", text: "TokenAlreadyConsumed" },
    },
  ],
} as const;

/** The reference capsule's physical tables, as `Capsule.ts` declares them. */
export const referenceTables = [
  {
    name: "capsule_reference_2e_tokens",
    columns: ["token_hash", "expires_at", "consumed_at?", "consumption_id?", "revoked_at?"],
  },
  { name: "capsule_reference_2e_token_audit", columns: ["token_hash", "consumed_at"] },
] as const;

/** The operations `OneTimeTokensService` declares, with their parameter names. */
export const tokenOperations = [
  { name: "issue", parameter: "expiresAt", returns: "IssuedToken" },
  { name: "get", parameter: "token", returns: "TokenState" },
  { name: "consume", parameter: "token", returns: "AuditReceipt" },
  { name: "revoke", parameter: "token", returns: "void" },
] as const;

/** Ledger tables CapsuleDB itself owns under the default `capsuledb` prefix. */
export const ledgerTables = ["capsuledb_registry_ledger", "capsuledb_registry_metadata"] as const;

/** Provider profiles the package exports. */
export const profiles = [
  "Pg.profile",
  "SqliteBun.profile",
  "Libsql.profile",
  "D1.profile",
] as const;
