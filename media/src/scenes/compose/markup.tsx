import type { SceneMarkup } from "../../scene";
import { Code, Database, Header, Line, Owned, Scene, Window } from "../parts";
import { hostComposition, ledgerTables, referenceTables } from "../source";

export const composeRows = [
  { name: "your app's own tables", kind: "host", owner: "app" },
  ...referenceTables.map((table) => ({
    name: table.name,
    kind: "capsule" as const,
    owner: "reference.tokens",
  })),
  ...ledgerTables.map((name) => ({ name, kind: "ledger" as const, owner: "capsuledb" })),
] as const;

/** The host names its capsules and lends its client; one database holds everyone's tables. */
export const compose: SceneMarkup = {
  id: "compose",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="02 · The host" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 172, fontSize: 88 }}>
        <Line a="title">The host composes</Line>
        <Line a="title">what it trusts.</Line>
      </h2>
      <Code
        code={hostComposition.code}
        file={hostComposition.file}
        aside="Source"
        fontSize={22}
        lineHeight={35}
        style={{ left: 96, top: 420, width: 970 }}
        highlights={[
          { a: "hi-registry", from: 3, to: 6, tone: "ink" },
          { a: "hi-client", from: 10, to: 10, tone: "ink" },
        ]}
      />
      <Window
        a="host"
        title="Host application"
        flat
        style={{ left: 1140, top: 152, width: 684, height: 372 }}
      >
        <div data-a="registry" style={{ padding: "22px 28px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="cx-mono" style={{ fontSize: 24, fontWeight: 600 }}>
              Registry.layer
            </span>
            <span data-a="badge-explicit" className="cx-mute" style={{ fontSize: 21 }}>
              Explicit. No discovery.
            </span>
          </div>
          <Owned a="capsule-row" aside="capsule" style={{ display: "flex", marginTop: 18 }}>
            reference.tokens
          </Owned>
        </div>
        <div
          data-a="client"
          className="cx-dark cx-abs"
          style={{ left: 28, right: 28, bottom: 28, height: 112, padding: "20px 24px" }}
        >
          <span className="cx-mono" style={{ fontSize: 24, fontWeight: 600 }}>
            SqlClient
          </span>
          <p
            className="cx-mono"
            style={{ margin: "12px 0 0", fontSize: 19, color: "var(--cx-dark-body)" }}
          >
            opened, shared, and closed by the host
          </p>
        </div>
      </Window>
      <i
        data-a="link"
        className="cx-abs"
        style={{
          left: 1481,
          top: 524,
          width: 2,
          height: 44,
          background: "var(--cx-hairline-strong)",
          transformOrigin: "top",
        }}
      />
      <Database rows={composeRows} width={684} style={{ left: 1140, top: 568 }} />
      <p
        className="cx-note cx-abs"
        data-a="footnote"
        style={{ left: 96, top: 1000, width: 1700, margin: 0 }}
      >
        Capsules are trusted package code. CapsuleDB prevents namespace collisions; it does not
        sandbox their SQL.
      </p>
    </Scene>
  ),
};
