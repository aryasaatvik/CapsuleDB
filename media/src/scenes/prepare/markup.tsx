import type { ReactNode } from "react";
import type { SceneMarkup } from "../../scene";
import { Badge, Check, Header, Line, Mark, Pill, Scene } from "../parts";

const detail = {
  margin: "16px 0 0",
  fontSize: 24,
  lineHeight: 1.4,
  color: "var(--cx-soft)",
} as const;

function Station({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div data-a="station" style={{ width: 318 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          className="cx-mono"
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
            background: "var(--cx-ink)",
            color: "var(--cx-paper)",
            display: "grid",
            placeItems: "center",
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          {n}
        </span>
        <span className="cx-h" style={{ fontSize: 46, fontWeight: 720 }}>
          {title}
        </span>
      </div>
      <div style={{ marginTop: 26 }}>{children}</div>
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
      <i
        className="cx-rule cx-abs"
        data-a="track"
        style={{ left: 96, right: 96, top: 506, height: 3 }}
      />
      <span data-a="marker" className="cx-abs" style={{ left: 96, top: 488 }}>
        <Mark height={36} />
      </span>
      <div className="cx-abs" style={{ left: 96, top: 556, display: "flex", gap: 32 }}>
        <Station n={1} title="Read">
          <p className="cx-mono" style={detail}>
            Metadata and ledger, in one statement.
          </p>
        </Station>
        <Station n={2} title="Pending">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              [1, "create-tokens"],
              [2, "add-token-audit"],
            ].map(([id, name]) => (
              <div
                key={id}
                data-a="pending"
                className="cx-row cx-row--capsule"
                style={{ fontSize: 22, gap: 10, height: 58 }}
              >
                <span style={{ fontWeight: 700 }}>{id}</span>
                {name}
                <span data-a="applied" style={{ marginLeft: "auto", color: "var(--cx-ready)" }}>
                  <Check size={26} />
                </span>
              </div>
            ))}
          </div>
        </Station>
        <Station n={3} title="Apply">
          <p className="cx-mono" style={detail}>
            Each migration commits with its ledger row.
          </p>
          <p className="cx-mono" style={{ ...detail, fontSize: 21 }}>
            PostgreSQL: under an advisory lock.
          </p>
        </Station>
        <Station n={4} title="Ready">
          <Badge tone="ready" a="ready">
            Ready
          </Badge>
          <p className="cx-mono" style={detail}>
            fingerprint · provider · capsules: 1
          </p>
        </Station>
        <Station n={5} title="Provide">
          <Pill a="service">OneTimeTokens</Pill>
          <p className="cx-mono" style={detail}>
            Only now does the service exist.
          </p>
        </Station>
      </div>
      <div className="cx-abs" style={{ left: 96, right: 96, top: 890, display: "flex", gap: 64 }}>
        <p
          data-a="aside"
          className="cx-h"
          style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.22, width: 820 }}
        >
          Already current? Ready from the first read, with no lock and no DDL.
        </p>
        <p
          data-a="aside"
          className="cx-h"
          style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.22, width: 820 }}
        >
          Drift or a failed migration fails the layer with a typed error.
        </p>
      </div>
    </Scene>
  ),
};
