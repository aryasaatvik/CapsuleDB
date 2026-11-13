import type { SceneMarkup } from "../../scene";
import { CapsuleTable, Code, Header, Line, Scene } from "../parts";
import { capsuleDefinition } from "../source";

/** Notes that take turns in one slot under the capsule, one per highlighted part of the code. */
export const anatomyNotes = [
  {
    a: "note-tables",
    title: "Tables",
    text: "Declared once with Schema.table. Rendered for PostgreSQL and SQLite.",
  },
  {
    a: "note-migrations",
    title: "Migrations",
    text: "Append-only and numbered from 1. Editing applied history reads as drift.",
  },
  {
    a: "note-service",
    title: "Service",
    text: "An Effect Layer that provides a typed domain service, not rows.",
  },
  {
    a: "note-id",
    title: "Identity",
    text: "reference.tokens derives the namespace capsule_reference_2e_tokens.",
  },
] as const;

/** The reference capsule, read part by part against a listing of what it declares. */
export const anatomy: SceneMarkup = {
  id: "anatomy",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="01 · The capsule" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 176, fontSize: 96 }}>
        <Line a="title">A capsule is</Line>
        <Line a="title">one value.</Line>
      </h2>
      <p className="cx-sub cx-abs" data-a="sub" style={{ left: 96, top: 396, width: 680 }}>
        Tables, append-only migrations, and a typed Effect service, exported as one constant.
      </p>
      <CapsuleTable
        id="reference.tokens"
        width={700}
        style={{ left: 96, top: 516 }}
        parts={[
          { label: "Tables", a: "c-tables", body: "2 tables" },
          { label: "Migrations", a: "c-migrations", body: "1 → 2" },
          { label: "Service", a: "c-service", body: "OneTimeTokens" },
        ]}
      />
      <div className="cx-abs" style={{ left: 96, top: 842, width: 700, height: 170 }}>
        {anatomyNotes.map((note) => (
          <div
            key={note.a}
            data-a={note.a}
            className="cx-abs"
            style={{ left: 0, top: 0, right: 0 }}
          >
            <span
              style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24 }}
              className="cx-mute"
            >
              <i className="cx-key" />
              {note.title}
            </span>
            <p
              className="cx-h"
              style={{
                marginTop: 12,
                fontSize: 34,
                fontWeight: 500,
                lineHeight: 1.24,
                letterSpacing: "-0.025em",
              }}
            >
              {note.text}
            </p>
          </div>
        ))}
      </div>
      <Code
        code={capsuleDefinition.code}
        file={capsuleDefinition.file}
        aside="Source"
        fontSize={25}
        lineHeight={38}
        style={{ left: 880, top: 152, width: 944 }}
        highlights={[
          { a: "hi-id", from: 1, to: 1, tone: "seal" },
          { a: "hi-tables", from: 2, to: 2, tone: "seal" },
          { a: "hi-migrations", from: 3, to: 16, tone: "seal" },
          { a: "hi-service", from: 17, to: 17, tone: "seal" },
        ]}
      />
    </Scene>
  ),
};
