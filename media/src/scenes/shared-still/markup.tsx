import type { ReactNode } from "react";
import type { SceneMarkup } from "../../scene";
import { Arrow, Database, Header, Pill, Scene } from "../parts";
import { ledgerTables, referenceTables } from "../source";

/** Capsule IDs and table names from the repository's examples and guides. */
const capsules = ["reference.tokens", "acme.tokens", "example.greeting"] as const;

const rows = [
  { name: "your app's own tables", kind: "host" },
  ...referenceTables.map((table) => ({ name: table.name, kind: "capsule" as const })),
  { name: "acme_tokens", kind: "capsule" },
  { name: "greeting", kind: "capsule" },
  ...ledgerTables.map((name) => ({ name, kind: "ledger" as const })),
] as const;

function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ flex: "1 1 0", borderTop: "3px solid var(--cx-ink)", paddingTop: 16 }}>
      <span className="cx-kicker cx-kicker--seal">{title}</span>
      <p
        className="cx-h"
        style={{ marginTop: 10, fontSize: 26, fontWeight: 540, lineHeight: 1.28 }}
      >
        {children}
      </p>
    </div>
  );
}

function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="cx-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontSize: 19,
        color: "var(--cx-soft)",
      }}
    >
      <i className="cx-swatch" style={{ background: color }} />
      {children}
    </span>
  );
}

/** Infographic: several capsules and the host's own persistence share one client and database. */
export const sharedStill: SceneMarkup = {
  id: "shared-still",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="Host composition" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 150, fontSize: 72 }}>
        One client. One database. Many capsules.
      </h2>
      <div className="cx-box" style={{ left: 96, top: 270, width: 960, height: 520 }}>
        <span className="cx-tag">Host application</span>
        <div
          className="cx-abs"
          style={{
            left: 30,
            top: 44,
            width: 560,
            height: 260,
            border: "3px solid var(--cx-ink)",
            borderRadius: 14,
            padding: "20px 24px",
          }}
        >
          <span className="cx-mono" style={{ fontSize: 25, fontWeight: 700 }}>
            Registry.layer
          </span>
          <span
            className="cx-mono"
            style={{ fontSize: 20, color: "var(--cx-soft)", marginLeft: 14 }}
          >
            capsules: [ … ]
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 20,
              alignItems: "flex-start",
            }}
          >
            {capsules.map((id) => (
              <Pill key={id} style={{ height: 50, fontSize: 21 }}>
                {id}
              </Pill>
            ))}
          </div>
        </div>
        <div
          className="cx-abs"
          style={{
            left: 620,
            top: 44,
            width: 306,
            height: 260,
            border: "3px dashed var(--cx-soft)",
            borderRadius: 14,
            padding: "20px 22px",
          }}
        >
          <span className="cx-mono" style={{ fontSize: 23, fontWeight: 700 }}>
            Your persistence
          </span>
          <p
            className="cx-mono"
            style={{ margin: "14px 0 0", fontSize: 20, lineHeight: 1.45, color: "var(--cx-soft)" }}
          >
            The host's own queries, for example an Effect Drizzle adapter.
          </p>
        </div>
        <div
          className="cx-abs"
          style={{
            left: 30,
            right: 30,
            top: 336,
            height: 150,
            borderRadius: 14,
            background: "var(--cx-ink)",
            color: "var(--cx-paper)",
            padding: "22px 26px",
          }}
        >
          <span className="cx-mono" style={{ fontSize: 27, fontWeight: 700 }}>
            SqlClient
          </span>
          <p
            className="cx-mono"
            style={{ margin: "14px 0 0", fontSize: 21, lineHeight: 1.45, opacity: 0.8 }}
          >
            Supplied by the host, which opens, shares, and closes it. Capsules receive it as an
            Effect service.
          </p>
        </div>
      </div>
      <span className="cx-abs" style={{ left: 1070, top: 590 }}>
        <Arrow size={44} />
      </span>
      <Database rows={rows} width={700} style={{ left: 1124, top: 270 }} />
      <div className="cx-abs" style={{ left: 1124, top: 770, display: "flex", gap: 26 }}>
        <Legend color="#ddd8cc">Host</Legend>
        <Legend color="var(--cx-seal-wash)">Capsules</Legend>
        <Legend color="var(--cx-ink)">CapsuleDB ledger</Legend>
      </div>
      <div className="cx-abs" style={{ left: 96, right: 96, top: 836, display: "flex", gap: 40 }}>
        <Rule title="Explicit">The host lists every capsule. Nothing is discovered.</Rule>
        <Rule title="Shared">Capsule layers require the host's SqlClient, not their own.</Rule>
        <Rule title="Recorded">One ledger records each capsule's applied migrations.</Rule>
        <Rule title="Trusted">Namespace collisions are rejected. Author SQL is not sandboxed.</Rule>
      </div>
      <p
        className="cx-note cx-abs"
        style={{ left: 96, right: 96, top: 1010, margin: 0, fontSize: 18 }}
      >
        Example capsule IDs from the repository guides. The optional deploy-time capsuledb/alchemy
        resource opens and closes its own client from a URL.
      </p>
    </Scene>
  ),
};
