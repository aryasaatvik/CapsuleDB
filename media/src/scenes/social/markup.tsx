import type { SceneMarkup } from "../../scene";
import { Mark, Scene } from "../parts";

/** The share card, laid out from its own canvas so 1200×630 and 1280×640 both keep their margins. */
export const social: SceneMarkup = {
  id: "social",
  render: (size) => {
    const margin = 72;
    return (
      <Scene size={size}>
        <div
          className="cx-abs"
          style={{
            left: margin,
            top: 64,
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: "-0.03em",
          }}
        >
          <Mark height={32} />
          CapsuleDB
        </div>
        <h1
          className="cx-h cx-abs"
          style={{
            left: margin,
            top: 168,
            fontSize: 84,
            lineHeight: 1.02,
            letterSpacing: "-0.045em",
          }}
        >
          <span style={{ display: "block" }}>Ship persistence</span>
          <span style={{ display: "block" }}>with your package.</span>
        </h1>
        <p
          className="cx-sub cx-abs"
          style={{ left: margin, top: 352, fontSize: 36, letterSpacing: "-0.02em" }}
        >
          Use the database the app already owns.
        </p>
        <div
          className="cx-abs"
          style={{
            left: margin,
            right: margin,
            bottom: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <span
            className="cx-mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              height: 64,
              padding: "0 24px",
              borderRadius: 8,
              background: "var(--cx-card)",
              boxShadow: "var(--cx-lift)",
              fontSize: 26,
              fontWeight: 500,
            }}
          >
            <span className="cx-mute">$</span>
            npm i capsuledb effect
          </span>
          <span className="cx-mono cx-mute" style={{ fontSize: 24 }}>
            github.com/aryasaatvik/CapsuleDB
          </span>
        </div>
      </Scene>
    );
  },
};
