import { Context, Effect, Predicate, Semaphore } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { Acquirer, Borrower } from "effect/unstable/sql/SqlConnection";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

/**
 * The pieces a host client builds its statements from.
 *
 * `SqlClient` exposes its transaction wrapper, reservation, and transaction
 * service, but not the compiler and connection acquirer behind its tagged
 * template. Every statement it creates carries them, so a probe statement is
 * where they are read from; the guard below turns a change in that shape into a
 * named defect at layer build instead of a broken query later.
 */
interface StatementParts {
  readonly acquirer: Acquirer;
  readonly compiler: Statement.Compiler;
  readonly spanAttributes: ReadonlyArray<readonly [string, unknown]>;
  readonly transformRows:
    | (<A extends object>(rows: ReadonlyArray<A>) => ReadonlyArray<A>)
    | undefined;
  readonly borrower: Borrower | undefined;
}

const isStatementParts = (value: unknown): value is StatementParts =>
  Predicate.hasProperty(value, "acquirer") &&
  Effect.isEffect(value.acquirer) &&
  Predicate.hasProperty(value, "compiler") &&
  Predicate.hasProperty(value.compiler, "compile") &&
  Predicate.isFunction(value.compiler.compile) &&
  Predicate.hasProperty(value, "spanAttributes") &&
  Array.isArray(value.spanAttributes) &&
  Predicate.hasProperty(value, "transformRows") &&
  (value.transformRows === undefined || Predicate.isFunction(value.transformRows)) &&
  Predicate.hasProperty(value, "borrower") &&
  (value.borrower === undefined || Predicate.isFunction(value.borrower));

/** Present a readiness failure through the SQL error channel a capsule already handles. */
const asSqlError = (cause: unknown): SqlError =>
  cause instanceof SqlError
    ? cause
    : new SqlError({
        reason: new UnknownError({
          cause,
          message: `CapsuleDB registry is not ready: ${String(cause)}`,
          operation: "capsuledb.registry.readiness",
        }),
      });

/**
 * Wrap a host client so that every connection it hands out first waits for
 * `check` to succeed.
 *
 * The gate sits on connection acquisition, reservation, and transactions, so it
 * covers any capsule without knowing what the capsule queries. Success is
 * remembered for the life of the wrapper; failure is not, so the next use runs
 * the check again. Concurrent first uses share one check.
 *
 * The check runs outside any transaction the caller has open on the host
 * client: its DDL and ledger writes commit on their own, and a caller that
 * rolls back cannot undo a readiness the wrapper has already remembered.
 */
export const make = <E>(
  inner: SqlClient.SqlClient,
  check: Effect.Effect<unknown, E>,
): Effect.Effect<SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const parts: unknown = inner.unsafe("");
    if (!isStatementParts(parts)) {
      return yield* Effect.die(
        new Error("CapsuleDB cannot gate this SqlClient: its statements do not expose a compiler"),
      );
    }

    const lock = yield* Semaphore.make(1);
    let ready = false;
    const outsideTransaction = Effect.updateContext(check, (context: Context.Context<never>) =>
      Context.omit(inner.transactionService)(context),
    );
    const awaitReady: Effect.Effect<void, SqlError> = Effect.suspend(() =>
      ready
        ? Effect.void
        : lock.withPermit(
            Effect.suspend(() =>
              ready
                ? Effect.void
                : outsideTransaction.pipe(
                    Effect.mapError(asSqlError),
                    Effect.map(() => {
                      ready = true;
                    }),
                  ),
            ),
          ),
    );

    const { borrower } = parts;
    const gatedBorrower: Borrower | undefined =
      borrower === undefined ? undefined : (f) => Effect.andThen(awaitReady, borrower(f));
    const acquirer: Acquirer = Effect.andThen(awaitReady, parts.acquirer);

    const withStatements = (
      compiler: Statement.Compiler,
      transformRows: StatementParts["transformRows"],
    ): SqlClient.SqlClient => {
      const client = Object.assign(
        Statement.make(acquirer, compiler, parts.spanAttributes, transformRows, gatedBorrower),
        {
          [SqlClientTypeId]: SqlClientTypeId,
          withoutTransforms: (): SqlClient.SqlClient =>
            transformRows === undefined
              ? complete
              : withStatements(compiler.withoutTransform, undefined),
          reserve: Effect.andThen(awaitReady, inner.reserve),
          // The host's own wrapper keeps its dialect's BEGIN and savepoint SQL,
          // and statements built here join its transaction through the shared
          // transaction service.
          withTransaction: <R, E2, A>(effect: Effect.Effect<A, E2, R>) =>
            Effect.andThen(awaitReady, inner.withTransaction(effect)),
          transactionService: inner.transactionService,
          reactive: inner.reactive,
          reactiveMailbox: inner.reactiveMailbox,
        },
      );
      // `safe` is the client itself, a self-reference the object literal
      // above cannot type; `SqlClient.make` assigns it the same way.
      const complete = Object.assign(client, { safe: client }) as SqlClient.SqlClient;
      return complete;
    };

    return withStatements(parts.compiler, parts.transformRows);
  });

const SqlClientTypeId = "~effect/sql/SqlClient" as const;
