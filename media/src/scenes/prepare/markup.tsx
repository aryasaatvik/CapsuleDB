import type { ReactNode } from "react";
import type { SceneMarkup } from "../../scene";
import { Badge, Check, Header, Line, Mark, Owned, Scene } from "../parts";

const detail = {
  margin: "0",
  fontSize: 22,
  lineHeight: 1.45,
  color: "var(--cx-body)",
} as const;

function Station({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div data-a="station" style={{ width: 318 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          className="cx-mono"
          style={{
            width: 44,
            height: 44,
            borderRadius: 6,
            background: "var(--cx-card)",
            boxShadow: "var(--cx-ring)",
            color: "var(--cx-body)",
            display: "grid",
            placeItems: "center",
            fontSize: 21,
            fontWeight: 500,
          }}
        >
          {n}
        </span>
        <span className="cx-h" style={{ fontSize: 44, letterSpacing: "-0.035em" }}>
          {title}
        </span>
      </div>
      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

/** Registry.layer's default path, station by station, ending with the service. */
export const prepare: SceneMarkup = {
  id: "prepare",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="03 · Preparation" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 172, fontSize: 88 }}>
        <Line a="title">Prepared before any</Line>
        <Line a="title">service is provided.</Line>
      </h2>
      <i className="cx-rule cx-abs" data-a="track" style={{ left: 96, right: 96, top: 462 }} />
      <span data-a="marker" className="cx-abs" style={{ left: 96, top: 446 }}>
        <Mark height={32} />
      </span>
      <div className="cx-abs" style={{ left: 96, top: 508, display: "flex", gap: 32 }}>
        <Station n={1} title="Read">
          <p className="cx-mono" style={detail}>
            Metadata and ledger, in one statement.
          </p>
        </Station>
        <Station n={2} title="Pending">
          {[
            [1, "create-tokens"],
            [2, "add-token-audit"],
          ].map(([id, name]) => (
            <Owned
              key={id}
              a="pending"
              style={{ display: "flex", gap: 14, color: "var(--cx-ink)" }}
              aside={
                <span data-a="applied" style={{ display: "block", color: "var(--cx-ready)" }}>
                  <Check size={26} />
                </span>
              }
            >
              <span className="cx-seal-ink">{id}</span>
              {name}
            </Owned>
          ))}
        </Station>
        <Station n={3} title="Apply">
          <p className="cx-mono" style={detail}>
            Each migration commits with its ledger row.
          </p>
          <p className="cx-mono" style={{ ...detail, fontSize: 20, color: "var(--cx-mute)" }}>
            PostgreSQL: under an advisory lock.
          </p>
        </Station>
        <Station n={4} title="Ready">
          <span>
            <Badge tone="ready" a="ready" style={{ fontSize: 22, height: 48, padding: "0 16px" }}>
              Ready
            </Badge>
          </span>
          <p className="cx-mono" style={detail}>
            fingerprint · provider · capsules: 1
          </p>
        </Station>
        <Station n={5} title="Provide">
          <span>
            <Owned a="service">OneTimeTokens</Owned>
          </span>
          <p className="cx-mono" style={detail}>
            Only now does the service exist.
          </p>
        </Station>
      </div>
      <div
        className="cx-abs"
        style={{
          left: 96,
          right: 96,
          top: 860,
          display: "flex",
          gap: 64,
        }}
      >
        <p
          data-a="aside"
          className="cx-h"
          style={{
            fontSize: 36,
            fontWeight: 500,
            lineHeight: 1.24,
            letterSpacing: "-0.025em",
            width: 820,
          }}
        >
          Already current? Ready from the first read, with no lock and no DDL.
        </p>
        <p
          data-a="aside"
          className="cx-h"
          style={{
            fontSize: 36,
            fontWeight: 500,
            lineHeight: 1.24,
            letterSpacing: "-0.025em",
            width: 820,
            color: "var(--cx-body)",
          }}
        >
          Drift or a failed migration fails the layer with a typed error.
        </p>
      </div>
    </Scene>
  ),
};
