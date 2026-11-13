import type { ReactNode } from "react";
import type { SceneMarkup } from "../../scene";
import { Header, Scene, TableName, Window } from "../parts";
import { referenceTables, tokenOperations } from "../source";

const TOP = 340;
const HEIGHT = 440;

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="cx-fact">
      <span className="cx-fact-title">{title}</span>
      <div className="cx-fact-text">{children}</div>
    </div>
  );
}

/** Infographic: the reference capsule's three parts, its identity, and what the host sees. */
export const anatomyStill: SceneMarkup = {
  id: "anatomy-still",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="Capsule anatomy" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 150, fontSize: 76 }}>
        One value carries a package's persistence.
      </h2>
      <p className="cx-sub cx-abs" style={{ left: 96, top: 254, fontSize: 30 }}>
        <span className="cx-ic">Capsule.make</span> exports tables, append-only migrations, and a
        typed Effect layer as one constant.
      </p>

      <Window
        title="Tables"
        aside="Schema.table"
        style={{ left: 96, top: TOP, width: 640, height: HEIGHT }}
      >
        <div className="cx-list" style={{ fontSize: 20 }}>
          {referenceTables.map((table) => (
            <div key={table.name}>
              <div
                className="cx-list-row cx-list-row--capsule"
                style={{ height: 50, gridTemplateColumns: "1fr", fontWeight: 600 }}
              >
                <TableName name={table.name} />
              </div>
              {table.columns.map((column) => (
                <div
                  key={column}
                  className="cx-list-row"
                  style={{
                    height: 36,
                    gridTemplateColumns: "1fr auto",
                    paddingLeft: 48,
                    borderBottom: "1px solid var(--cx-hairline)",
                  }}
                >
                  <span>{column.replace(/\?$/, "")}</span>
                  <span className="cx-mute">{column.endsWith("?") ? "nullable" : ""}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Window>

      <Window
        title="Migrations"
        aside="append-only"
        style={{ left: 760, top: TOP, width: 500, height: HEIGHT }}
      >
        <div style={{ padding: "8px 0" }}>
          {[
            [1, "create-tokens", "createTable(tokens)"],
            [2, "add-token-audit", "createTable(tokenAudit)"],
          ].map(([id, name, step]) => (
            <div
              key={id}
              className="cx-mono"
              style={{
                padding: "18px 28px",
                borderBottom: "1px solid var(--cx-hairline)",
                display: "grid",
                gridTemplateColumns: "40px 1fr",
                rowGap: 6,
              }}
            >
              <span className="cx-mute" style={{ fontSize: 22 }}>
                {id}
              </span>
              <span style={{ fontSize: 22, fontWeight: 600 }}>{name}</span>
              <span />
              <span style={{ fontSize: 19, color: "var(--cx-body)" }}>additive · {step}</span>
            </div>
          ))}
          <div
            className="cx-mono cx-mute"
            style={{
              margin: "16px 20px 0",
              height: 52,
              padding: "0 7px",
              border: "1px dashed var(--cx-hairline-strong)",
              borderRadius: 6,
              display: "grid",
              gridTemplateColumns: "40px 1fr",
              alignItems: "center",
              fontSize: 20,
            }}
          >
            <span>3</span>
            <span>appended next</span>
          </div>
        </div>
      </Window>

      <Window
        title="Service"
        aside="Layer"
        style={{ left: 1284, top: TOP, width: 540, height: HEIGHT }}
      >
        <div style={{ padding: "22px 28px 12px" }}>
          <div className="cx-mono" style={{ fontSize: 24, fontWeight: 600 }}>
            OneTimeTokens
          </div>
          <div
            className="cx-mono"
            style={{ fontSize: 18, color: "var(--cx-body)", marginTop: 8, whiteSpace: "nowrap" }}
          >
            Layer&lt;OneTimeTokens, never, SqlClient&gt;
          </div>
        </div>
        <div
          className="cx-list"
          style={{ fontSize: 20, borderTop: "1px solid var(--cx-hairline)" }}
        >
          <div
            className="cx-list-head"
            style={{ gridTemplateColumns: "1fr auto", fontFamily: "var(--cx-sans)", height: 42 }}
          >
            <span>Operation</span>
            <span>Returns</span>
          </div>
          {tokenOperations.map((operation) => (
            <div
              key={operation.name}
              className="cx-list-row"
              style={{ gridTemplateColumns: "1fr auto", height: 48 }}
            >
              <span>
                <b style={{ color: "var(--cx-ink)", fontWeight: 600 }}>{operation.name}</b>
                <span className="cx-mute">({operation.parameter})</span>
              </span>
              <span style={{ color: "var(--cx-ink)" }}>{operation.returns}</span>
            </div>
          ))}
        </div>
      </Window>

      <div className="cx-abs" style={{ left: 96, right: 96, top: 828, display: "flex", gap: 56 }}>
        <Fact title="Identity">
          <span className="cx-mono" style={{ display: "block", fontSize: 22, lineHeight: 1.5 }}>
            <span className="cx-seal-ink">reference.tokens</span> <span className="cx-mute">→</span>
          </span>
          <span className="cx-mono" style={{ display: "block", fontSize: 22, lineHeight: 1.5 }}>
            <span style={{ color: "var(--cx-ink)" }}>capsule_reference_2e_tokens</span>
          </span>
          Derived; hosts cannot rename it.
        </Fact>
        <Fact title="Dialects">
          Declared once. Rendered for PostgreSQL and SQLite: Bun SQLite, libSQL, and D1.
        </Fact>
        <Fact title="Boundary">
          The host calls the service. Queries and row shapes stay inside the package.
        </Fact>
      </div>
      <p className="cx-note cx-abs" style={{ left: 96, top: 1028, margin: 0, fontSize: 18 }}>
        From examples/reference-token/Capsule.ts and OneTimeTokens.ts
      </p>
    </Scene>
  ),
};
