import type { SceneMarkup } from "../../scene";
import { Kicker, Line, Scene } from "../parts";

/** The package author's problem, in type alone. */
export const hook: SceneMarkup = {
  id: "hook",
  render: (size) => (
    <Scene size={size}>
      <Kicker a="kicker" seal style={{ position: "absolute", left: 160, top: 312 }}>
        For package authors
      </Kicker>
      <h1
        className="cx-h cx-abs"
        style={{ left: 160, top: 372, fontSize: 100, whiteSpace: "nowrap", lineHeight: 1.06 }}
      >
        <Line a="need">Your package needs tables.</Line>
        <Line a="own">
          <span style={{ color: "var(--cx-soft)" }}>The app owns the database.</span>
        </Line>
      </h1>
      <i className="cx-bar cx-abs" data-a="bar" style={{ left: 160, top: 636, width: 200 }} />
      <div
        className="cx-abs"
        style={{ left: 160, top: 690, display: "flex", gap: 36, whiteSpace: "nowrap" }}
      >
        <span className="cx-mask">
          <span data-a="split" className="cx-h" style={{ fontSize: 72, fontWeight: 700 }}>
            Bring the tables.
          </span>
        </span>
        <span className="cx-mask">
          <span data-a="split" className="cx-h cx-seal" style={{ fontSize: 72, fontWeight: 700 }}>
            Borrow the client.
          </span>
        </span>
      </div>
    </Scene>
  ),
};
