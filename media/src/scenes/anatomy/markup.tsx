import type { SceneMarkup } from "../../scene";
import { CapsuleShape, Code, Header, Line, Scene } from "../parts";
import { capsuleDefinition } from "../source";

const small = { fontFamily: "var(--cx-mono)", fontSize: 19, color: "var(--cx-soft)" } as const;

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

/** The reference capsule, read part by part against the capsule diagram. */
export const anatomy: SceneMarkup = {
  id: "anatomy",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="01 · The capsule" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 176, fontSize: 96 }}>
        <Line a="title">A capsule is</Line>
        <Line a="title">one value.</Line>
      </h2>
      <p className="cx-sub cx-abs" data-a="sub" style={{ left: 96, top: 400, width: 680 }}>
        Tables, append-only migrations, and a typed Effect service, exported as one constant.
      </p>
      <CapsuleShape
        width={700}
        height={176}
        style={{ left: 96, top: 568 }}
        compartments={[
          { label: "Tables", a: "c-tables", body: <span style={small}>2 tables</span> },
          { label: "Migrations", a: "c-migrations", body: <span style={small}>1 → 2</span> },
          { label: "Service", a: "c-service", body: <span style={small}>OneTimeTokens</span> },
        ]}
      />
      <div className="cx-abs" style={{ left: 96, top: 800, width: 700, height: 180 }}>
        {anatomyNotes.map((note) => (
          <div
            key={note.a}
            data-a={note.a}
            className="cx-abs"
            style={{ left: 0, top: 0, right: 0 }}
          >
            <span className="cx-kicker cx-kicker--seal">{note.title}</span>
            <p
              className="cx-h"
              style={{ marginTop: 14, fontSize: 36, fontWeight: 560, lineHeight: 1.2 }}
            >
              {note.text}
            </p>
          </div>
        ))}
      </div>
      <Code
        code={capsuleDefinition.code}
        file={capsuleDefinition.file}
        fontSize={25}
        lineHeight={38}
        style={{ left: 880, top: 152, width: 944 }}
        highlights={[
          { a: "hi-id", from: 1, to: 1 },
          { a: "hi-tables", from: 2, to: 2 },
          { a: "hi-migrations", from: 3, to: 16 },
          { a: "hi-service", from: 17, to: 17 },
        ]}
      />
    </Scene>
  ),
};
