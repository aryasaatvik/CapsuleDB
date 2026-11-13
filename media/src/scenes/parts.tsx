import type { CSSProperties, ReactNode } from "react";
import type { Size } from "../scene";

/**
 * Primitives shared by the film, the infographics, and the cards: hairline windows, listings, and
 * code panes. Styling lives in `src/styles.css`; `data-a="<name>"` marks what a motion animates.
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

/** The wordmark, set in ink as the site sets it; the mark carries the seal. */
export function Wordmark({ size, a }: { size: number; a?: string }) {
  return (
    <span data-a={a} className="cx-h" style={{ fontSize: size, letterSpacing: "-0.045em" }}>
      CapsuleDB
    </span>
  );
}

export function Scene({ size, children }: { size: Size; children: ReactNode }) {
  return (
    <div className="cx-scene" style={{ width: size.width, height: size.height }}>
      {children}
    </div>
  );
}

/** Brand left, chapter right, a hairline beneath. */
export function Header({ chapter }: { chapter: string }) {
  return (
    <header className="cx-header" data-a="header">
      <span className="cx-brand">
        <Mark height={24} />
        <span>CapsuleDB</span>
      </span>
      <span className="cx-label">{chapter}</span>
    </header>
  );
}

/** A muted sentence-case label. */
export function Label({
  children,
  a,
  style,
}: {
  children: ReactNode;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className="cx-label" style={style}>
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

/** `ready` and `pending` are real states; `error` is a typed failure; `type` names a result. */
export type Tone = "ready" | "pending" | "error" | "type";

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
      {tone === "ready" || tone === "pending" ? <i /> : null}
      {children}
    </span>
  );
}

/** Something a capsule owns, shown outside a listing: a square row with the seal rule. */
export function Owned({
  children,
  a,
  aside,
  style,
}: {
  children: ReactNode;
  a?: string;
  aside?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className="cx-owned" style={style}>
      {children}
      {aside === undefined ? null : (
        <span style={{ marginLeft: "auto", fontFamily: "var(--cx-sans)", color: "var(--cx-mute)" }}>
          {aside}
        </span>
      )}
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
        strokeWidth="1.8"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Check({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M4.5 12.5l4.5 4.5L19.5 6.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/* Windows ---------------------------------------------------------------------------------- */

/** A hairline window: a bar naming its file, command, or role, then its content. */
export function Window({
  title,
  aside,
  a,
  flat,
  style,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  a?: string | undefined;
  flat?: boolean;
  style?: CSSProperties | undefined;
  children: ReactNode;
}) {
  return (
    <div data-a={a} className={flat ? "cx-window cx-window--flat" : "cx-window"} style={style}>
      <div className="cx-winbar">
        <span>{title}</span>
        {aside === undefined ? null : <span>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/* Code ------------------------------------------------------------------------------------- */

/** The capsule ID; wherever it appears as a string literal it carries the seal mark. */
export const capsuleIdLiteral = '"reference.tokens"';

const KEYWORDS = /^(?:import|from|export|const|yield)$/;
const TOKEN =
  /("[^"]*"|\/\/.*$|\b\d+\b|\b(?:import|from|export|const|yield)\b|[A-Za-z_$][\w$]*|\s+|.)/g;

function tokenClass(token: string): string | undefined {
  if (token === capsuleIdLiteral) return "tk-id";
  if (token.startsWith('"')) return "tk-str";
  if (token.startsWith("//")) return "tk-com";
  if (KEYWORDS.test(token)) return "tk-kw";
  return undefined;
}

/** Monochrome spans for one line of TypeScript: keywords and strings in ink, the rest grey. */
export function highlightLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let index = 0;
  for (const match of line.matchAll(TOKEN)) {
    const token = match[0];
    const className = tokenClass(token);
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
  /** `seal` for what the capsule declares, `ink` for what the host writes. */
  readonly tone: "seal" | "ink";
}

/** A code pane in a hairline window. Lines carry `data-a="code-line"`; highlights sit behind. */
export function Code({
  code,
  file,
  aside,
  fontSize,
  lineHeight,
  highlights = [],
  a = "code",
  style,
}: {
  code: string;
  file: string;
  aside?: ReactNode;
  fontSize: number;
  lineHeight: number;
  highlights?: ReadonlyArray<CodeHighlight>;
  a?: string;
  style?: CSSProperties;
}) {
  const lines = code.split("\n");
  return (
    <Window title={file} aside={aside} a={a} style={style}>
      <div className="cx-code-body" style={{ fontSize, lineHeight: `${lineHeight}px` }}>
        {highlights.map((highlight) => (
          <i
            key={highlight.a}
            data-a={highlight.a}
            className={`cx-code-hi cx-code-hi--${highlight.tone}`}
            style={{
              top: 24 + highlight.from * lineHeight,
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
    </Window>
  );
}

/* Listings --------------------------------------------------------------------------------- */

/** The reference capsule's table prefix, as `Capsule.ts` names its tables. */
export const referencePrefix = "capsule_reference_2e_";

/** A table name, with the reference capsule's prefix in the seal's text tone. */
export function TableName({ name }: { name: string }) {
  if (!name.startsWith(referencePrefix)) return <span>{name}</span>;
  return (
    <span>
      <span className="cx-nsp">{referencePrefix}</span>
      {name.slice(referencePrefix.length)}
    </span>
  );
}

export interface Part {
  readonly label: string;
  readonly a: string;
  readonly body: ReactNode;
}

/**
 * A capsule read as a property listing: one row per part it declares. Each row's wash
 * (`<a>-fill`) draws in when the motion names that part.
 */
export function CapsuleTable({
  id,
  parts,
  width,
  a = "capsule",
  style,
}: {
  id: string;
  parts: ReadonlyArray<Part>;
  width: number;
  a?: string;
  style?: CSSProperties;
}) {
  const columns = { gridTemplateColumns: "200px 1fr" };
  return (
    <Window
      a={a}
      title={<span className="cx-seal-ink">{id}</span>}
      aside="Capsule.make"
      style={{ width, ...style }}
    >
      <div className="cx-list">
        <div className="cx-list-head" style={{ ...columns, fontFamily: "var(--cx-sans)" }}>
          <span>Part</span>
          <span>Declares</span>
        </div>
        {parts.map((part) => (
          <div key={part.a} className="cx-list-row" style={{ ...columns, height: 58 }}>
            <i className="cx-fill" data-a={`${part.a}-fill`} />
            <span
              data-a={`${part.a}-label`}
              style={{ fontFamily: "var(--cx-sans)", fontWeight: 600, color: "var(--cx-ink)" }}
            >
              {part.label}
            </span>
            <span>{part.body}</span>
          </div>
        ))}
      </div>
    </Window>
  );
}

export type RowKind = "host" | "capsule" | "ledger";

export interface TableRow {
  readonly name: string;
  readonly kind: RowKind;
  readonly owner: string;
}

/** The host database as a `\dt` listing: every table and who owns it. */
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
  const columns = { gridTemplateColumns: "1fr auto" };
  return (
    <Window a={a} title="\dt" aside="Host database" style={{ width, ...style }}>
      <div className="cx-list">
        <div className="cx-list-head" style={{ ...columns, fontFamily: "var(--cx-sans)" }}>
          <span>Name</span>
          <span>Owned by</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.name}
            data-a={`${a}-row`}
            className={`cx-list-row cx-list-row--${row.kind}`}
            style={columns}
          >
            {row.kind === "host" ? (
              <span style={{ fontFamily: "var(--cx-sans)", fontStyle: "italic" }}>{row.name}</span>
            ) : (
              <TableName name={row.name} />
            )}
            <span className="cx-owner" style={{ paddingLeft: 24 }}>
              {row.owner}
            </span>
          </div>
        ))}
      </div>
    </Window>
  );
}
