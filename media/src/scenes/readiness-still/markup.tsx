import type { CSSProperties, ReactNode } from "react";
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

/** Ready is a real state; Provide is where the capsule's service appears. */
const nodeStyle = (title: string): CSSProperties =>
  title === "Ready"
    ? { background: "var(--cx-ready-soft)", boxShadow: "inset 0 0 0 1px rgba(29, 111, 69, 0.28)" }
    : title === "Provide"
      ? {
          background: "var(--cx-seal-soft)",
          boxShadow: "inset var(--cx-rule-w) 0 0 var(--cx-seal), var(--cx-ring)",
        }
      : { background: "var(--cx-card)", boxShadow: "var(--cx-ring)" };

function Card({ title, mono, children }: { title: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="cx-fact" style={{ paddingTop: 20 }}>
      <span
        className={mono ? "cx-fact-title cx-mono" : "cx-fact-title"}
        style={mono ? { fontSize: 23, letterSpacing: 0 } : undefined}
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
    <div style={{ fontSize: 22, lineHeight: 1.4 }}>
      <span className="cx-mono" style={{ fontWeight: 600 }}>
        {name}
      </span>
      {note === undefined ? null : (
        <span className="cx-mono cx-mute" style={{ fontSize: 19 }}>
          {" "}
          {note}
        </span>
      )}
      <div style={{ color: "var(--cx-body)", marginTop: 2 }}>{children}</div>
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
      <p className="cx-sub cx-abs" style={{ left: 96, top: 252, fontSize: 28 }}>
        What <span className="cx-ic">Registry.layer</span> does while the layer builds, with the
        defaults <span className="cx-ic">mode: "prepare"</span> and{" "}
        <span className="cx-ic">readiness: "boot"</span>.
      </p>
      {/* The fast path: a current registry is Ready from the first read. */}
      <div
        className="cx-abs"
        style={{
          left: nodeLeft(0) + NODE_WIDTH / 2,
          width: nodeLeft(4) - nodeLeft(0),
          top: 348,
          height: 40,
          border: "2px solid var(--cx-ready)",
          borderBottom: 0,
          borderRadius: "8px 8px 0 0",
        }}
      />
      <span
        className="cx-abs cx-mono"
        style={{
          left: nodeLeft(1) + 30,
          top: 333,
          padding: "0 14px",
          background: "var(--cx-canvas)",
          color: "var(--cx-ready)",
          fontSize: 21,
          fontWeight: 500,
          lineHeight: "30px",
        }}
      >
        Already current: Ready from the first read. No lock, no DDL.
      </span>
      {steps.map((step, index) => (
        <div
          key={step.title}
          className="cx-abs"
          style={{
            left: nodeLeft(index),
            top: 388,
            width: NODE_WIDTH,
            height: 162,
            padding: "18px 20px",
            borderRadius: 8,
            ...nodeStyle(step.title),
          }}
        >
          <span className="cx-h" style={{ fontSize: 32, letterSpacing: "-0.03em" }}>
            {step.title}
          </span>
          <p
            className="cx-mono"
            style={{ margin: "12px 0 0", fontSize: 19, lineHeight: 1.4, color: "var(--cx-body)" }}
          >
            {step.detail}
          </p>
          {index < steps.length - 1 ? (
            <span className="cx-abs" style={{ right: -41, top: 62, color: "var(--cx-mute)" }}>
              <Arrow size={38} />
            </span>
          ) : null}
        </div>
      ))}
      <i
        className="cx-abs"
        style={{
          left: nodeLeft(2) + NODE_WIDTH + NODE_GAP / 2 - 1,
          top: 550,
          width: 2,
          height: 48,
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
          borderRadius: 8,
          background: "var(--cx-seal-soft)",
          boxShadow: "inset 0 0 0 1px rgba(226, 80, 43, 0.35)",
          fontSize: 23,
          lineHeight: 1.35,
          color: "var(--cx-body)",
        }}
      >
        <b style={{ fontWeight: 600, color: "var(--cx-seal-ink)" }}>Drift or a failed migration</b>{" "}
        fails the layer with a typed error. No service is provided.
      </div>
      <div className="cx-abs" style={{ left: 96, right: 96, top: 736, display: "flex", gap: 56 }}>
        <Card title="Readiness states">
          <div style={{ display: "flex", gap: 12 }}>
            <Badge tone="pending">Pending</Badge>
            <Badge tone="ready">Ready</Badge>
            <Badge tone="error">Drift</Badge>
          </div>
          <div style={{ fontSize: 22, lineHeight: 1.4, color: "var(--cx-body)" }}>
            <span className="cx-mono">status</span> reports any of the three.{" "}
            <span className="cx-mono">prepare</span> and <span className="cx-mono">assert</span>{" "}
            return Ready or fail with a typed error. Drift needs an operator; preparation will not
            repair it.
          </div>
        </Card>
        <Card title="mode:" mono>
          <Option name={'"prepare"'} note="default">
            Applies pending migrations.
          </Option>
          <Option name={'"assert"'}>
            Applies nothing; fails with NotReady unless Ready. For emitted SQL or deploy-time
            preparation.
          </Option>
        </Card>
        <Card title="readiness:" mono>
          <Option name={'"boot"'} note="default">
            Checks while the layer builds.
          </Option>
          <Option name={'"first-use"'}>
            Defers the check to the first use of the client, which can come while capsule services
            build. After a failure, the next use checks again.
          </Option>
        </Card>
      </div>
      <p
        className="cx-note cx-abs"
        style={{ left: 96, right: 96, top: 1024, margin: 0, fontSize: 18 }}
      >
        PostgreSQL serializes preparation with an advisory lock. D1 applies each migration as one
        bounded atomic batch, without interactive transactions.
      </p>
    </Scene>
  ),
};
