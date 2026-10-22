import type { SceneMarkup } from "../../scene";
import { Badge, Code, Database, Header, Line, Pill, Scene } from "../parts";
import { hostComposition, ledgerTables, referenceTables } from "../source";

export const composeRows = [
  { name: "your app's own tables", kind: "host" },
  ...referenceTables.map((table) => ({ name: table.name, kind: "capsule" as const })),
  ...ledgerTables.map((name) => ({ name, kind: "ledger" as const })),
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
        fontSize={22}
        lineHeight={35}
        style={{ left: 96, top: 420, width: 970 }}
        highlights={[
          { a: "hi-registry", from: 3, to: 6 },
          { a: "hi-client", from: 10, to: 10 },
        ]}
      />
      <div
        data-a="host"
        className="cx-box"
        style={{ left: 1140, top: 150, width: 684, height: 400 }}
      >
        <span className="cx-tag">Host application</span>
        <div
          data-a="registry"
          className="cx-abs"
          style={{
            left: 28,
            right: 28,
            top: 40,
            height: 170,
            border: "3px solid var(--cx-ink)",
            borderRadius: 14,
            padding: "18px 22px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="cx-mono" style={{ fontSize: 24, fontWeight: 700 }}>
              Registry.layer
            </span>
            <Badge tone="seal" a="badge-explicit" style={{ fontSize: 18, height: 38 }}>
              Explicit. No discovery.
            </Badge>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 22, alignItems: "center" }}>
            <Pill a="pill">reference.tokens</Pill>
          </div>
        </div>
        <div
          data-a="client"
          className="cx-abs"
          style={{
            left: 28,
            right: 28,
            top: 238,
            height: 130,
            borderRadius: 14,
            background: "var(--cx-ink)",
            color: "var(--cx-paper)",
            padding: "20px 24px",
          }}
        >
          <span className="cx-mono" style={{ fontSize: 24, fontWeight: 700 }}>
            SqlClient
          </span>
          <p className="cx-mono" style={{ margin: "12px 0 0", fontSize: 19, opacity: 0.75 }}>
            opened, shared, and closed by the host
          </p>
        </div>
      </div>
      <i
        data-a="link"
        className="cx-abs"
        style={{
          left: 1480,
          top: 550,
          width: 3,
          height: 60,
          background: "var(--cx-ink)",
          transformOrigin: "top",
        }}
      />
      <Database rows={composeRows} width={684} style={{ left: 1140, top: 628 }} />
      <p
        className="cx-note cx-abs"
        data-a="footnote"
        style={{ left: 96, top: 1000, width: 1700, fontSize: 18 }}
      >
        Capsules are trusted package code. CapsuleDB prevents namespace collisions; it does not
        sandbox their SQL.
      </p>
    </Scene>
  ),
};
