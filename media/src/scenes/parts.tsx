import type { CSSProperties, ReactNode } from "react";
import type { Size } from "../scene";

/**
 * Ledger primitives shared by the film, the infographics, and the cards. Styling lives in
 * `src/styles.css`; `data-a="<name>"` marks what a motion animates.
 */

/** The capsule mark from `src/brand/capsuledb-mark.svg`: a host-held half sealed to a package half. */
export function Mark({ height, a }: { height: number; a?: string }) {
  return (
    <svg
      data-a={a}
      width={(height * 48) / 32}
      height={height}
      viewBox="0 0 48 32"
      fill="none"
      style={{ display: "block", flexShrink: 0, overflow: "visible" }}
    >
      <g data-a={a === undefined ? undefined : `${a}-host`}>
        <path d="M24 5H16a11 11 0 0 0 0 22h8" stroke="var(--cx-ink)" strokeWidth="3" />
        <path d="M11 13h8M11 19h8" stroke="var(--cx-ink)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <path
        data-a={a === undefined ? undefined : `${a}-package`}
        d="M24 3.5h8a12.5 12.5 0 0 1 0 25h-8z"
        fill="var(--cx-seal)"
      />
    </svg>
  );
}

/** "Capsule" in ink and "DB" in seal, the identity's only wordmark. */
export function Wordmark({ size, a }: { size: number; a?: string }) {
  return (
    <span
      data-a={a}
      className="cx-h"
      style={{ fontSize: size, fontWeight: 780, fontStretch: "118%", letterSpacing: "-0.04em" }}
    >
      Capsule<span className="cx-seal">DB</span>
    </span>
  );
}

export function Scene({ size, children }: { size: Size; children: ReactNode }) {
  return (
    <div className="cx-scene" style={{ width: size.width, height: size.height }}>
      <i className="cx-ruling" />
      {children}
    </div>
  );
}

/** Brand left, chapter right, a ruled line beneath. */
export function Header({ chapter }: { chapter: string }) {
  return (
    <header className="cx-header" data-a="header">
      <span className="cx-brand">
        <Mark height={26} />
        <span>
          Capsule<b>DB</b>
        </span>
      </span>
      <span className="cx-kicker">{chapter}</span>
    </header>
  );
}

export function Kicker({
  children,
  a,
  seal,
  style,
}: {
  children: ReactNode;
  a?: string;
  seal?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className={seal ? "cx-kicker cx-kicker--seal" : "cx-kicker"} style={style}>
      {children}
    </span>
  );
}

/** One line of display type that rises out of its mask; the mask clips it by design. */
export function Line({ children, a = "line" }: { children: ReactNode; a?: string }) {
  return (
    <span className="cx-mask" data-layout-allow-overflow="">
      <span data-a={a}>{children}</span>
    </span>
  );
}

export type Tone = "ready" | "pending" | "seal" | "ink" | "code";

export function Badge({
  tone,
  children,
  a,
  style,
}: {
  tone: Tone;
  children: ReactNode;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className={`cx-badge cx-badge--${tone}`} style={style}>
      <i />
      {children}
    </span>
  );
}

export function Pill({
  children,
  a,
  style,
}: {
  children: ReactNode;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className="cx-pill" style={style}>
      <i />
      {children}
    </span>
  );
}

export function Arrow({ size = 28, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: "block", flexShrink: 0, color: color ?? "currentColor" }}
    >
      <path
        d="M4 12h15M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Check({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M4 12.5l5 5L20 6.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Code ------------------------------------------------------------------------------------- */

const TOKEN =
  /("[^"]*"|\/\/.*$|\b\d+\b|\b(?:import|from|export|const|yield)\b|[A-Za-z_$][\w$]*|\s+|.)/g;

function tokenClass(token: string): string | undefined {
  if (token.startsWith('"')) return "tk-str";
  if (token.startsWith("//")) return "tk-com";
  if (/^\d+$/.test(token)) return "tk-num";
  if (/^(?:import|from|export|const|yield)$/.test(token)) return "tk-kw";
  return undefined;
}

/** Syntax-colored spans for one line of TypeScript. */
export function highlightLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let index = 0;
  for (const match of line.matchAll(TOKEN)) {
    const token = match[0];
    const end = (match.index ?? 0) + token.length;
    const isKey = /^[A-Za-z_$][\w$]*$/.test(token) && line[end] === ":";
    const className = isKey ? "tk-key" : tokenClass(token);
    parts.push(
      className === undefined ? (
        token
      ) : (
        <span key={index} className={className}>
          {token}
        </span>
      ),
    );
    index += 1;
  }
  return parts;
}

export interface CodeHighlight {
  readonly a: string;
  /** First and last highlighted line, zero-based and inclusive. */
  readonly from: number;
  readonly to: number;
}

/** A dark code panel. Lines carry `data-a="code-line"`; highlights sit behind their lines. */
export function Code({
  code,
  file,
  fontSize,
  lineHeight,
  highlights = [],
  a = "code",
  style,
}: {
  code: string;
  file?: string;
  fontSize: number;
  lineHeight: number;
  highlights?: ReadonlyArray<CodeHighlight>;
  a?: string;
  style?: CSSProperties;
}) {
  const lines = code.split("\n");
  return (
    <div className="cx-code" data-a={a} style={style}>
      {file === undefined ? null : (
        <div className="cx-code-file">
          <i />
          {file}
        </div>
      )}
      <div style={{ position: "relative", fontSize, lineHeight: `${lineHeight}px` }}>
        {highlights.map((highlight) => (
          <i
            key={highlight.a}
            data-a={highlight.a}
            className="cx-code-hi"
            style={{
              top: highlight.from * lineHeight,
              height: (highlight.to - highlight.from + 1) * lineHeight,
            }}
          />
        ))}
        {lines.map((line, index) => (
          <div key={index} className="cx-code-line" data-a="code-line">
            {line === "" ? " " : highlightLine(line)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Capsule ---------------------------------------------------------------------------------- */

export interface Compartment {
  readonly label: string;
  readonly a: string;
  readonly body?: ReactNode;
  /** Relative width; compartments share the capsule equally by default. */
  readonly grow?: number;
}

/** The capsule diagram: a stadium split into compartments that fill as they are named. */
export function CapsuleShape({
  width,
  height,
  compartments,
  a = "capsule",
  style,
}: {
  width: number;
  height: number;
  compartments: ReadonlyArray<Compartment>;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-a={a}
      className="cx-capsule"
      style={{ width, height, borderRadius: height / 2, ...style }}
    >
      {compartments.map((compartment, index) => (
        <div
          key={compartment.a}
          className="cx-cell"
          style={{
            flexGrow: compartment.grow ?? 1,
            paddingLeft: index === 0 ? height * 0.34 : 30,
            paddingRight: index === compartments.length - 1 ? height * 0.2 : 24,
          }}
        >
          <i className="cx-cell-fill" data-a={`${compartment.a}-fill`} />
          <span className="cx-label" data-a={`${compartment.a}-label`}>
            {compartment.label}
          </span>
          {compartment.body}
        </div>
      ))}
    </div>
  );
}

/* Database --------------------------------------------------------------------------------- */

export type RowKind = "host" | "capsule" | "ledger";

export interface TableRow {
  readonly name: string;
  readonly kind: RowKind;
}

/** The host database as a ledger of tables, grouped by who owns each one. */
export function Database({
  rows,
  width,
  a = "db",
  style,
}: {
  rows: ReadonlyArray<TableRow>;
  width: number;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <div data-a={a} className="cx-box" style={{ width, padding: "34px 26px 26px", ...style }}>
      <span className="cx-tag">Host database</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row) => (
          <div key={row.name} data-a={`${a}-row`} className={`cx-row cx-row--${row.kind}`}>
            {row.name}
          </div>
        ))}
      </div>
    </div>
  );
}
