import type { ReactNode } from "react";
import type { SceneMarkup } from "../../scene";
import { Arrow, Database, Header, Owned, Scene, Window } from "../parts";
import { ledgerTables, referenceTables } from "../source";

/** Capsule IDs and table names from the repository's examples and guides. */
const capsules = ["reference.tokens", "acme.tokens", "example.greeting"] as const;

const rows = [
  { name: "your app's own tables", kind: "host", owner: "app" },
  ...referenceTables.map((table) => ({
    name: table.name,
    kind: "capsule" as const,
    owner: "reference.tokens",
  })),
  { name: "acme_tokens", kind: "capsule", owner: "acme.tokens" },
  { name: "greeting", kind: "capsule", owner: "example.greeting" },
  ...ledgerTables.map((name) => ({ name, kind: "ledger" as const, owner: "capsuledb" })),
] as const;

function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="cx-fact" style={{ paddingTop: 18 }}>
      <span className="cx-fact-title" style={{ fontSize: 23 }}>
        {title}
      </span>
      <p className="cx-fact-text" style={{ fontSize: 24 }}>
        {children}
      </p>
    </div>
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
      <Window title="Host application" flat style={{ left: 96, top: 270, width: 960, height: 520 }}>
        <div
          className="cx-abs"
          style={{
            left: 28,
            top: 88,
            width: 560,
            height: 262,
            borderRadius: 6,
            background: "var(--cx-inset)",
            boxShadow: "var(--cx-ring)",
            padding: "20px 22px",
          }}
        >
          <span className="cx-mono" style={{ fontSize: 24, fontWeight: 600 }}>
            Registry.layer
          </span>
          <span className="cx-mono cx-mute" style={{ fontSize: 20, marginLeft: 14 }}>
            capsules: [ … ]
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
            {capsules.map((id) => (
              <Owned key={id} style={{ display: "flex", height: 50, fontSize: 21 }}>
                {id}
              </Owned>
            ))}
          </div>
        </div>
        <div
          className="cx-abs"
          style={{
            left: 612,
            top: 88,
            width: 320,
            height: 262,
            border: "1px dashed var(--cx-hairline-strong)",
            borderRadius: 6,
            padding: "20px 22px",
          }}
        >
          <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
            Your persistence
          </span>
          <p
            style={{ margin: "12px 0 0", fontSize: 21, lineHeight: 1.45, color: "var(--cx-body)" }}
          >
            The host's own queries, for example an Effect Drizzle adapter.
          </p>
        </div>
        <div
          className="cx-abs cx-dark"
          style={{ left: 28, right: 28, top: 372, height: 124, padding: "18px 24px" }}
        >
          <span className="cx-mono" style={{ fontSize: 25, fontWeight: 600 }}>
            SqlClient
          </span>
          <p
            className="cx-mono"
            style={{
              margin: "12px 0 0",
              fontSize: 20,
              lineHeight: 1.45,
              color: "var(--cx-dark-body)",
            }}
          >
            Supplied by the host, which opens, shares, and closes it. Capsules receive it as an
            Effect service.
          </p>
        </div>
      </Window>
      <span className="cx-abs" style={{ left: 1068, top: 608, color: "var(--cx-mute)" }}>
        <Arrow size={44} />
      </span>
      <Database rows={rows} width={700} style={{ left: 1124, top: 270 }} />
      <div className="cx-abs" style={{ left: 96, right: 96, top: 840, display: "flex", gap: 40 }}>
        <Rule title="Explicit">The host lists every capsule. Nothing is discovered.</Rule>
        <Rule title="Shared">Capsule layers require the host's SqlClient, not their own.</Rule>
        <Rule title="Recorded">One ledger records each capsule's applied migrations.</Rule>
        <Rule title="Trusted">Namespace collisions are rejected. Author SQL is not sandboxed.</Rule>
      </div>
      <p
        className="cx-note cx-abs"
        style={{ left: 96, right: 96, top: 1012, margin: 0, fontSize: 18 }}
      >
        Example capsule IDs from the repository guides. The optional deploy-time capsuledb/alchemy
        resource opens and closes its own client from a URL.
      </p>
    </Scene>
  ),
};
