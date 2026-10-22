import type { ReactNode } from "react";
import type { SceneMarkup } from "../../scene";
import { Arrow, Badge, Header, Scene } from "../parts";

const NODE_WIDTH = 252;
const NODE_GAP = 43;
const nodeLeft = (index: number) => 96 + index * (NODE_WIDTH + NODE_GAP);

const steps = [
  { title: "Read", detail: "metadata and ledger in one statement" },
  { title: "Ensure", detail: "ledger and metadata tables exist" },
  { title: "Validate", detail: "applied rows, checksums, provider" },
  { title: "Apply", detail: "each pending migration with its ledger row" },
  { title: "Ready", detail: "fingerprint, provider, capsules agree" },
  { title: "Provide", detail: "capsule layers build on the host client" },
] as const;

function Card({
  title,
  option,
  children,
}: {
  title: string;
  option?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ flex: "1 1 0", borderTop: "3px solid var(--cx-ink)", paddingTop: 18 }}>
      <span
        className="cx-kicker cx-kicker--seal"
        style={
          option ? { textTransform: "none", letterSpacing: "0.02em", fontSize: 22 } : undefined
        }
      >
        {title}
      </span>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Option({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div style={{ fontSize: 23, lineHeight: 1.35 }}>
      <span className="cx-mono" style={{ fontWeight: 700 }}>
        {name}
      </span>
      {note === undefined ? null : (
        <span className="cx-mono" style={{ color: "var(--cx-soft)", fontSize: 19 }}>
          {" "}
          {note}
        </span>
      )}
      <div style={{ color: "var(--cx-soft)", marginTop: 2 }}>{children}</div>
    </div>
  );
}

/** Infographic: Registry.layer's preparation path, its fast path, and the readiness options. */
export const readinessStill: SceneMarkup = {
  id: "readiness-still",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="Preparation and readiness" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 150, fontSize: 76 }}>
        Ready before any service exists.
      </h2>
      <p className="cx-sub cx-abs" style={{ left: 96, top: 246, fontSize: 28 }}>
        What{" "}
        <span className="cx-mono" style={{ color: "var(--cx-ink)", fontSize: 26 }}>
          Registry.layer
        </span>{" "}
        does while the layer builds, with the defaults{" "}
        <span className="cx-mono" style={{ color: "var(--cx-ink)", fontSize: 26 }}>
          mode: "prepare"
        </span>{" "}
        and{" "}
        <span className="cx-mono" style={{ color: "var(--cx-ink)", fontSize: 26 }}>
          readiness: "boot"
        </span>
        .
      </p>
      {/* The fast path: a current registry is Ready from the first read. */}
      <div
        className="cx-abs"
        style={{
          left: nodeLeft(0) + NODE_WIDTH / 2,
          width: nodeLeft(4) - nodeLeft(0),
          top: 336,
          height: 48,
          border: "3px solid var(--cx-ready)",
          borderBottom: 0,
          borderRadius: "16px 16px 0 0",
        }}
      />
      <span
        className="cx-abs cx-mono"
        style={{
          left: nodeLeft(1) + 30,
          top: 318,
          padding: "0 14px",
          background: "var(--cx-paper)",
          color: "var(--cx-ready)",
          fontSize: 21,
          fontWeight: 700,
        }}
      >
        Already current: Ready from the first read. No lock, no DDL.
      </span>
      {steps.map((step, index) => (
        <div
          key={step.title}
          className="cx-box"
          style={{
            left: nodeLeft(index),
            top: 384,
            width: NODE_WIDTH,
            height: 162,
            padding: "18px 20px",
            background:
              step.title === "Ready"
                ? "var(--cx-ready-wash)"
                : step.title === "Provide"
                  ? "var(--cx-seal-wash)"
                  : "var(--cx-panel)",
          }}
        >
          <span className="cx-h" style={{ fontSize: 32, fontWeight: 720 }}>
            {step.title}
          </span>
          <p
            className="cx-mono"
            style={{ margin: "12px 0 0", fontSize: 19, lineHeight: 1.4, color: "var(--cx-soft)" }}
          >
            {step.detail}
          </p>
          {index < steps.length - 1 ? (
            <span className="cx-abs" style={{ right: -42, top: 62 }}>
              <Arrow size={38} />
            </span>
          ) : null}
        </div>
      ))}
      <i
        className="cx-abs"
        style={{
          left: nodeLeft(2) + NODE_WIDTH + NODE_GAP / 2 - 1.5,
          top: 546,
          width: 3,
          height: 52,
          background: "var(--cx-seal)",
        }}
      />
      <div
        className="cx-abs"
        style={{
          left: nodeLeft(2),
          width: NODE_WIDTH * 2 + NODE_GAP,
          top: 598,
          padding: "16px 22px",
          border: "3px solid var(--cx-seal)",
          borderRadius: 16,
          background: "var(--cx-seal-wash)",
          fontSize: 23,
          lineHeight: 1.35,
        }}
      >
        <b>Drift or a failed migration</b> fails the layer with a typed error. No service is
        provided.
      </div>
      <div className="cx-abs" style={{ left: 96, right: 96, top: 732, display: "flex", gap: 56 }}>
        <Card title="Readiness states">
          <div style={{ display: "flex", gap: 12 }}>
            <Badge tone="pending">Pending</Badge>
            <Badge tone="ready">Ready</Badge>
            <Badge tone="seal">Drift</Badge>
          </div>
          <div style={{ fontSize: 23, lineHeight: 1.35, color: "var(--cx-soft)" }}>
            One union from <span className="cx-mono">status</span>,{" "}
            <span className="cx-mono">prepare</span>, and <span className="cx-mono">assert</span>.
            Drift needs an operator; preparation will not repair it.
          </div>
        </Card>
        <Card title="mode:" option>
          <Option name={'"prepare"'} note="default">
            Applies pending migrations.
          </Option>
          <Option name={'"assert"'}>
            Applies nothing; fails with NotReady unless Ready. For emitted SQL or deploy-time
            preparation.
          </Option>
        </Card>
        <Card title="readiness:" option>
          <Option name={'"boot"'} note="default">
            Checks while the layer builds.
          </Option>
          <Option name={'"first-use"'}>
            Builds without a statement; a capsule's first query runs the check. After a failure, the
            next use checks again.
          </Option>
        </Card>
      </div>
      <p
        className="cx-note cx-abs"
        style={{ left: 96, right: 96, top: 1022, margin: 0, fontSize: 18 }}
      >
        PostgreSQL serializes preparation with an advisory lock. D1 applies each migration as one
        bounded atomic batch, without interactive transactions.
      </p>
    </Scene>
  ),
};
