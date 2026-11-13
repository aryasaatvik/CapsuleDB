import type { SceneMarkup } from "../../scene";
import { Label, Line, Scene } from "../parts";

/** The package author's problem, in type alone. */
export const hook: SceneMarkup = {
  id: "hook",
  render: (size) => (
    <Scene size={size}>
      <Label a="kicker" style={{ position: "absolute", left: 160, top: 300, fontSize: 26 }}>
        For package authors
      </Label>
      <h1
        className="cx-h cx-abs"
        style={{
          left: 160,
          top: 360,
          fontSize: 104,
          whiteSpace: "nowrap",
          lineHeight: 1.04,
          letterSpacing: "-0.045em",
        }}
      >
        <Line a="need">Your package needs tables.</Line>
        <Line a="own">
          <span className="cx-mute">The app owns the database.</span>
        </Line>
      </h1>
      <i className="cx-bar cx-abs" data-a="bar" style={{ left: 160, top: 640, width: 160 }} />
      <div
        className="cx-abs"
        style={{ left: 160, top: 690, display: "flex", gap: 32, whiteSpace: "nowrap" }}
      >
        <span className="cx-mask">
          <span data-a="split" className="cx-h cx-seal-ink" style={{ fontSize: 72 }}>
            Bring the tables.
          </span>
        </span>
        <span className="cx-mask">
          <span data-a="split" className="cx-h" style={{ fontSize: 72 }}>
            Borrow the client.
          </span>
        </span>
      </div>
    </Scene>
  ),
};
