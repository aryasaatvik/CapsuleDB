import { Context, Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type * as Statement from "effect/unstable/sql/Statement";

import { InvalidToken, TokenAlreadyConsumed, TokenNotFound } from "../../src/Error.ts";

const TOKEN_TABLE = "capsule_reference_2e_tokens";
const AUDIT_TABLE = "capsule_reference_2e_token_audit";

/** Opaque token value returned by the reference capsule. */
export const Token = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(64, 64), Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("OneTimeToken"),
);

export type Token = typeof Token.Type;

/** Result of issuing a token; the database stores only its private digest. */
export const IssuedToken = Schema.Struct({
  token: Token,
  expiresAt: Schema.String,
});

export type IssuedToken = typeof IssuedToken.Type;

/** Public token lifecycle state; no persistence row or digest is exposed. */
export const TokenState = Schema.TaggedUnion({
  Pending: { expiresAt: Schema.String },
  Consumed: { expiresAt: Schema.String, consumedAt: Schema.String },
  Revoked: { expiresAt: Schema.String, revokedAt: Schema.String },
  Expired: { expiresAt: Schema.String },
});

export type TokenState = typeof TokenState.Type;

/** Receipt returned only after consume and audit have committed together. */
export const AuditReceipt = Schema.Struct({
  token: Token,
  consumedAt: Schema.String,
});

export type AuditReceipt = typeof AuditReceipt.Type;

export interface OneTimeTokensService {
  readonly issue: (expiresAt: unknown) => Effect.Effect<IssuedToken, InvalidToken | SqlError>;
  readonly get: (
    token: unknown,
  ) => Effect.Effect<TokenState, InvalidToken | TokenNotFound | SqlError>;
  readonly consume: (
    token: unknown,
  ) => Effect.Effect<AuditReceipt, InvalidToken | TokenNotFound | TokenAlreadyConsumed | SqlError>;
  readonly revoke: (token: unknown) => Effect.Effect<void, InvalidToken | TokenNotFound | SqlError>;
}

/** Effect service for the opaque one-time-token domain. */
export class OneTimeTokens extends Context.Service<OneTimeTokens, OneTimeTokensService>()(
  "examples/reference-token/OneTimeTokens",
) {}

interface TokenRow {
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly consumption_id: string | null;
  readonly revoked_at: string | null;
}

interface DatabaseInstant {
  readonly iso: string;
  readonly timestamp: number;
}

/** The only extra client operation used by the D1 domain path. */
interface AtomicBatchSql extends SqlClient.SqlClient {
  readonly batch: (
    statements: ReadonlyArray<Statement.Statement<unknown>>,
  ) => Effect.Effect<ReadonlyArray<unknown>, SqlError>;
}

const isAtomicBatchSql = (sql: SqlClient.SqlClient): sql is AtomicBatchSql =>
  typeof (sql as unknown as { readonly batch?: unknown }).batch === "function";

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const SQLITE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?$/;

/** Parse only full ISO-8601 timestamps with an explicit timezone. */
const parseIsoTimestamp = (input: unknown): number | undefined => {
  if (typeof input !== "string") return undefined;
  const match = ISO_TIMESTAMP_PATTERN.exec(input);
  if (match === null) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezone = match[7];
  if (
    timezone === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }
  if (timezone !== "Z") {
    const offsetHour = Number(timezone.slice(1, 3));
    const offsetMinute = Number(timezone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return undefined;
    }
  }

  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

/** Normalize the provider result shapes returned by `CURRENT_TIMESTAMP`. */
const parseDatabaseTimestamp = (input: unknown): number | undefined => {
  if (input instanceof Date) {
    const timestamp = input.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  if (typeof input !== "string") return undefined;

  const isoTimestamp = parseIsoTimestamp(input);
  if (isoTimestamp !== undefined) return isoTimestamp;

  const sqliteTimestamp = SQLITE_TIMESTAMP_PATTERN.exec(input);
  if (sqliteTimestamp === null) return undefined;
  const fraction = sqliteTimestamp[3]?.slice(0, 3).padEnd(3, "0") ?? "000";
  return parseIsoTimestamp(`${sqliteTimestamp[1]}T${sqliteTimestamp[2]}.${fraction}Z`);
};

const readDatabaseInstant = (
  sql: SqlClient.SqlClient,
): Effect.Effect<DatabaseInstant, InvalidToken | SqlError> =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly database_now: unknown }>`
      SELECT CURRENT_TIMESTAMP AS database_now`;
    const timestamp = parseDatabaseTimestamp(rows[0]?.database_now);
    if (timestamp === undefined) {
      return yield* Effect.fail(
        new InvalidToken({ reason: "the database returned an invalid current timestamp" }),
      );
    }
    return { iso: new Date(timestamp).toISOString(), timestamp };
  });

const decodeToken = (input: unknown): Effect.Effect<Token, InvalidToken> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(Token)(input),
    catch: () =>
      new InvalidToken({ reason: "token must be a 64-character lowercase hexadecimal value" }),
  });

const digest = (token: Token): Effect.Effect<string, InvalidToken> =>
  Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    catch: () => new InvalidToken({ reason: "the runtime could not hash the token" }),
  }).pipe(
    Effect.map((bytes) =>
      Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );

const generateToken = (): Token =>
  Schema.decodeUnknownSync(Token)(
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  );

const generateConsumptionId = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const validateExpiry = (
  input: unknown,
  databaseNow: DatabaseInstant,
): Effect.Effect<string, InvalidToken> =>
  Effect.gen(function* () {
    const timestamp = parseIsoTimestamp(input);
    if (timestamp === undefined) {
      return yield* Effect.fail(
        new InvalidToken({ reason: "expiresAt must be an ISO-8601 timestamp" }),
      );
    }
    if (timestamp <= databaseNow.timestamp) {
      return yield* Effect.fail(new InvalidToken({ reason: "expiresAt must be in the future" }));
    }
    return new Date(timestamp).toISOString();
  });

const readToken = (
  sql: SqlClient.SqlClient,
  tokenHash: string,
): Effect.Effect<TokenRow | undefined, SqlError> =>
  Effect.gen(function* () {
    const rows = yield* sql<TokenRow>`SELECT expires_at, consumed_at, consumption_id, revoked_at
      FROM ${sql(TOKEN_TABLE)} WHERE token_hash = ${tokenHash}`;
    return rows[0];
  });

const stateOf = (
  row: TokenRow,
  databaseNow: DatabaseInstant,
): Effect.Effect<TokenState, InvalidToken> =>
  Effect.gen(function* () {
    const expiresAt = parseIsoTimestamp(row.expires_at);
    if (expiresAt === undefined) {
      return yield* Effect.fail(new InvalidToken({ reason: "stored token expiry is invalid" }));
    }
    if (row.revoked_at !== null)
      return { _tag: "Revoked", expiresAt: row.expires_at, revokedAt: row.revoked_at };
    if (row.consumed_at !== null)
      return { _tag: "Consumed", expiresAt: row.expires_at, consumedAt: row.consumed_at };
    if (expiresAt <= databaseNow.timestamp) return { _tag: "Expired", expiresAt: row.expires_at };
    return { _tag: "Pending", expiresAt: row.expires_at };
  });

const makeService = (sql: SqlClient.SqlClient): OneTimeTokensService => ({
  issue: (expiresAt) =>
    Effect.gen(function* () {
      const databaseNow = yield* readDatabaseInstant(sql);
      const validExpiry = yield* validateExpiry(expiresAt, databaseNow);
      const token = generateToken();
      const tokenHash = yield* digest(token);
      yield* sql`INSERT INTO ${sql(TOKEN_TABLE)} (token_hash, expires_at, consumed_at)
        VALUES (${tokenHash}, ${validExpiry}, NULL)`;
      return { token, expiresAt: validExpiry };
    }),

  get: (input) =>
    Effect.gen(function* () {
      const token = yield* decodeToken(input);
      const tokenHash = yield* digest(token);
      const row = yield* readToken(sql, tokenHash);
      if (row === undefined) return yield* Effect.fail(new TokenNotFound({ token: "redacted" }));
      return yield* stateOf(row, yield* readDatabaseInstant(sql));
    }),

  consume: (input) =>
    Effect.gen(function* () {
      const token = yield* decodeToken(input);
      const tokenHash = yield* digest(token);
      const consumptionId = generateConsumptionId();

      if (isAtomicBatchSql(sql)) {
        const databaseNow = yield* readDatabaseInstant(sql);
        const updatedStatement = sql<TokenRow>`UPDATE ${sql(TOKEN_TABLE)}
          SET consumed_at = ${databaseNow.iso}, consumption_id = ${consumptionId}
          WHERE token_hash = ${tokenHash}
            AND consumed_at IS NULL
            AND consumption_id IS NULL
            AND revoked_at IS NULL
            AND expires_at > ${databaseNow.iso}
          RETURNING expires_at, consumed_at, consumption_id, revoked_at`;
        const auditStatement = sql`INSERT INTO ${sql(AUDIT_TABLE)} (token_hash, consumed_at)
          SELECT ${tokenHash}, ${databaseNow.iso}
          WHERE EXISTS (
            SELECT 1 FROM ${sql(TOKEN_TABLE)}
            WHERE token_hash = ${tokenHash} AND consumption_id = ${consumptionId}
          )`;
        const results = yield* sql.batch([updatedStatement, auditStatement]);
        const updated = (results[0] ?? []) as ReadonlyArray<TokenRow>;
        if (updated.length === 0) {
          const current = yield* readToken(sql, tokenHash);
          if (current?.consumed_at !== null && current?.consumed_at !== undefined) {
            return yield* Effect.fail(
              new TokenAlreadyConsumed({ token: "redacted", consumedAt: current.consumed_at }),
            );
          }
          return yield* Effect.fail(new TokenNotFound({ token: "redacted" }));
        }
        return { token, consumedAt: databaseNow.iso };
      }

      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const databaseNow = yield* readDatabaseInstant(sql);
          const row = yield* readToken(sql, tokenHash);
          if (row === undefined)
            return yield* Effect.fail(new TokenNotFound({ token: "redacted" }));
          if (row.revoked_at !== null)
            return yield* Effect.fail(new TokenNotFound({ token: "redacted" }));
          if (row.consumed_at !== null) {
            return yield* Effect.fail(
              new TokenAlreadyConsumed({ token: "redacted", consumedAt: row.consumed_at }),
            );
          }
          const expiresAt = parseIsoTimestamp(row.expires_at);
          if (expiresAt === undefined || expiresAt <= databaseNow.timestamp) {
            return yield* Effect.fail(new TokenNotFound({ token: "redacted" }));
          }

          const updated = yield* sql<TokenRow>`UPDATE ${sql(TOKEN_TABLE)}
            SET consumed_at = ${databaseNow.iso}, consumption_id = ${consumptionId}
            WHERE token_hash = ${tokenHash}
              AND consumed_at IS NULL
              AND consumption_id IS NULL
              AND revoked_at IS NULL
              AND expires_at > ${databaseNow.iso}
            RETURNING expires_at, consumed_at, consumption_id, revoked_at`;
          if (updated.length === 0) {
            const current = yield* readToken(sql, tokenHash);
            if (current?.consumed_at !== null && current?.consumed_at !== undefined) {
              return yield* Effect.fail(
                new TokenAlreadyConsumed({ token: "redacted", consumedAt: current.consumed_at }),
              );
            }
            return yield* Effect.fail(new TokenNotFound({ token: "redacted" }));
          }

          yield* sql`INSERT INTO ${sql(AUDIT_TABLE)} (token_hash, consumed_at)
            VALUES (${tokenHash}, ${databaseNow.iso})`;
          return { token, consumedAt: databaseNow.iso };
        }),
      );
    }),

  revoke: (input) =>
    Effect.gen(function* () {
      const token = yield* decodeToken(input);
      const tokenHash = yield* digest(token);
      const databaseNow = yield* readDatabaseInstant(sql);
      const updated = yield* sql<TokenRow>`UPDATE ${sql(TOKEN_TABLE)}
        SET revoked_at = ${databaseNow.iso}
        WHERE token_hash = ${tokenHash} AND consumed_at IS NULL AND revoked_at IS NULL
        RETURNING expires_at, consumed_at, revoked_at`;
      if (updated.length === 0) return yield* Effect.fail(new TokenNotFound({ token: "redacted" }));
    }),
});

/** Host-supplied SQL client layer for the package-owned domain service. */
export namespace OneTimeTokens {
  export const layer: Layer.Layer<OneTimeTokens, never, SqlClient.SqlClient> = Layer.effect(
    OneTimeTokens,
    Effect.map(Effect.service(SqlClient.SqlClient), makeService),
  );
}
