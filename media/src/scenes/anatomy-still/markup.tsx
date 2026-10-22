import type { ReactNode } from "react";
import type { SceneMarkup } from "../../scene";
import { CapsuleShape, Header, Scene } from "../parts";
import { referenceTables, tokenOperations } from "../source";

const mono = { fontFamily: "var(--cx-mono)" } as const;

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ flex: "1 1 0", borderTop: "3px solid var(--cx-ink)", paddingTop: 20 }}>
      <span className="cx-kicker cx-kicker--seal">{title}</span>
      <p
        className="cx-h"
        style={{ marginTop: 14, fontSize: 30, fontWeight: 540, lineHeight: 1.28 }}
      >
        {children}
      </p>
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
      <p className="cx-sub cx-abs" style={{ left: 96, top: 248, fontSize: 30 }}>
        <span className="cx-mono" style={{ fontSize: 27, color: "var(--cx-ink)" }}>
          Capsule.make
        </span>{" "}
        exports tables, append-only migrations, and a typed Effect layer as one constant.
      </p>
      <CapsuleShape
        width={1728}
        height={430}
        style={{ left: 96, top: 330 }}
        compartments={[
          {
            label: "Tables",
            a: "tables",
            grow: 1.25,
            body: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 6 }}>
                {referenceTables.map((table) => (
                  <div key={table.name}>
                    <div style={{ ...mono, fontSize: 22, fontWeight: 700 }}>{table.name}</div>
                    <div
                      style={{
                        ...mono,
                        fontSize: 20,
                        color: "var(--cx-soft)",
                        marginTop: 6,
                        lineHeight: 1.4,
                      }}
                    >
                      {table.columns.join("  ")}
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
          {
            label: "Migrations",
            a: "migrations",
            grow: 0.95,
            body: (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
                {[
                  [1, "create-tokens", "createTable(tokens)"],
                  [2, "add-token-audit", "createTable(tokenAudit)"],
                ].map(([id, name, step]) => (
                  <div
                    key={id}
                    className="cx-row cx-row--capsule"
                    style={{
                      height: 76,
                      flexDirection: "column",
                      alignItems: "flex-start",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 22, fontWeight: 700 }}>
                      {id} · {name}
                    </span>
                    <span style={{ fontSize: 19, color: "var(--cx-soft)" }}>additive · {step}</span>
                  </div>
                ))}
                <div
                  className="cx-row"
                  style={{
                    height: 50,
                    border: "2px dashed var(--cx-faint)",
                    color: "var(--cx-soft)",
                    fontSize: 20,
                  }}
                >
                  3 · appended next
                </div>
              </div>
            ),
          },
          {
            label: "Service",
            a: "service",
            grow: 1.1,
            body: (
              <div style={{ marginTop: 6 }}>
                <div style={{ ...mono, fontSize: 22, fontWeight: 700 }}>OneTimeTokens</div>
                <div
                  style={{
                    ...mono,
                    fontSize: 19,
                    color: "var(--cx-soft)",
                    marginTop: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  Layer&lt;OneTimeTokens, never, SqlClient&gt;
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
                  {tokenOperations.map((operation) => (
                    <div key={operation.name} style={{ ...mono, fontSize: 21 }}>
                      <b>{operation.name}</b>
                      <span style={{ color: "var(--cx-soft)" }}>({operation.parameter}) → </span>
                      {operation.returns}
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
        ]}
      />
      <div className="cx-abs" style={{ left: 96, right: 96, top: 812, display: "flex", gap: 56 }}>
        <Fact title="Identity">
          <span className="cx-mono" style={{ display: "block", fontSize: 24 }}>
            reference.tokens →
          </span>
          <span className="cx-mono" style={{ display: "block", fontSize: 24 }}>
            capsule_reference_2e_tokens
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
      <p className="cx-note cx-abs" style={{ left: 96, top: 1026, margin: 0, fontSize: 18 }}>
        From examples/reference-token/Capsule.ts and OneTimeTokens.ts · CapsuleDB 0.5
      </p>
    </Scene>
  ),
};
