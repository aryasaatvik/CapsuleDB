import type { SceneMarkup } from "../../scene";
import { Arrow, Badge, Header, Line, Scene, Window, highlightLine } from "../parts";
import { tokenOperations, tokenUsage } from "../source";

/** The host calls domain operations; each call's typed result appears beside it. */
export const use: SceneMarkup = {
  id: "use",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="04 · The service" />
      <h2 className="cx-h cx-abs" style={{ left: 96, top: 172, fontSize: 88 }}>
        <Line a="title">Call the domain.</Line>
        <Line a="title">
          <span className="cx-mute">The tables stay private.</span>
        </Line>
      </h2>
      <Window
        a="code"
        title={tokenUsage.file}
        aside="Illustrative calls"
        style={{ left: 96, top: 420, width: 1728 }}
      >
        <div className="cx-code-body" style={{ padding: "20px 0" }}>
          {tokenUsage.lines.map((line, index) => (
            <div
              key={index}
              data-a="use-line"
              className="cx-code-line"
              style={{
                display: "flex",
                alignItems: "center",
                height: 66,
                fontSize: 30,
                borderTop: index === 0 ? undefined : "1px solid var(--cx-hairline)",
              }}
            >
              <span style={{ width: 1000 }}>{highlightLine(line.code)}</span>
              {line.result === undefined ? null : (
                <span data-a="result" style={{ display: "flex", alignItems: "center", gap: 22 }}>
                  <span style={{ color: "var(--cx-mute)" }}>
                    <Arrow size={30} />
                  </span>
                  <Badge tone={line.result.tone} style={{ fontSize: 24, height: 46 }}>
                    {line.result.text}
                  </Badge>
                </span>
              )}
            </div>
          ))}
        </div>
      </Window>
      <div
        data-a="ops"
        className="cx-abs cx-mono"
        style={{
          left: 96,
          right: 96,
          top: 930,
          display: "flex",
          gap: 44,
          fontSize: 26,
          fontWeight: 600,
        }}
      >
        {tokenOperations.map((operation) => (
          <span key={operation.name}>
            {operation.name}
            <span className="cx-mute" style={{ fontWeight: 400 }}>
              ({operation.parameter})
            </span>
          </span>
        ))}
        <span className="cx-mute" style={{ marginLeft: "auto", fontWeight: 400 }}>
          OneTimeTokensService
        </span>
      </div>
    </Scene>
  ),
};
