import { Effect, Tracer } from "effect";

/** What one effect sent to the database, as the SQL client's own spans record it. */
export interface Recording {
  /** The text of every executed statement, in order. */
  readonly statements: ReadonlyArray<string>;
  /** How many transactions (including savepoints) were opened. */
  readonly transactions: number;
  /** How many spans carried each name, for counting higher-level operations. */
  readonly spans: (name: string) => number;
}

/**
 * Run an effect under a tracer that keeps every span, and report the
 * statements and transactions the Effect SQL client opened for it.
 *
 * Statement span names depend on the database target. Identify them by
 * `effect.sql.method` and `db.query.text`, and count `sql.transaction` spans
 * separately to keep round-trip assertions at the real client boundary.
 */
export const recordStatements = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<readonly [A, Recording], E, R> =>
  Effect.suspend(() => {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    return effect.pipe(
      Effect.withTracer(tracer),
      Effect.map((value) => {
        const recording: Recording = {
          statements: spans
            .filter(
              (span) =>
                span.attributes.has("effect.sql.method") && span.attributes.has("db.query.text"),
            )
            .map((span) => String(span.attributes.get("db.query.text"))),
          transactions: spans.filter((span) => span.name === "sql.transaction").length,
          spans: (name) => spans.filter((span) => span.name === name).length,
        };
        return [value, recording] as const;
      }),
    );
  });
