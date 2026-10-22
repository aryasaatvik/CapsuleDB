import type { SceneMarkup } from "../../scene";
import { Mark, Scene, Wordmark } from "../parts";

/** The share card, laid out from its own canvas so 1200×630 and 1280×640 both keep their margins. */
export const social: SceneMarkup = {
  id: "social",
  render: (size) => {
    const margin = 72;
    return (
      <Scene size={size}>
        <span className="cx-abs" style={{ left: size.width - 340, top: 168 }}>
          <Mark height={270} />
        </span>
        <div
          className="cx-abs"
          style={{ left: margin, top: 62, display: "flex", alignItems: "center", gap: 22 }}
        >
          <Mark height={58} />
          <Wordmark size={60} />
        </div>
        <h1
          className="cx-h cx-abs"
          style={{ left: margin, top: 188, fontSize: 80, lineHeight: 1.04 }}
        >
          <span style={{ display: "block" }}>Ship persistence</span>
          <span style={{ display: "block" }}>with your package.</span>
        </h1>
        <p className="cx-sub cx-abs" style={{ left: margin, top: 380, fontSize: 36 }}>
          Use the database the app already owns.
        </p>
        <i className="cx-bar cx-abs" style={{ left: margin, top: 462, width: 120 }} />
        <div
          className="cx-abs cx-mono"
          style={{
            left: margin,
            right: margin,
            bottom: 56,
            paddingTop: 22,
            borderTop: "2px solid var(--cx-ink)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 25,
            fontWeight: 600,
          }}
        >
          <span>
            <span className="cx-seal">$</span> bun add capsuledb
          </span>
          <span style={{ color: "var(--cx-soft)" }}>github.com/aryasaatvik/CapsuleDB</span>
        </div>
      </Scene>
    );
  },
};
