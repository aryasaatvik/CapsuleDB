import type { SceneMarkup } from "../../scene";
import { Line, Mark, Scene, Wordmark } from "../parts";

/** The mark seals, the wordmark lands, and the promise is stated once. */
export const reveal: SceneMarkup = {
  id: "reveal",
  render: (size) => (
    <Scene size={size}>
      <div
        className="cx-abs"
        style={{ left: 160, top: 250, display: "flex", alignItems: "center", gap: 44 }}
      >
        <Mark height={140} a="mark" />
        <span className="cx-mask">
          <span data-a="wordmark">
            <Wordmark size={176} />
          </span>
        </span>
      </div>
      <h2
        className="cx-h cx-abs"
        style={{ left: 160, top: 530, fontSize: 76, lineHeight: 1.08, letterSpacing: "-0.04em" }}
      >
        <Line a="tagline">Ship persistence with your package.</Line>
        <Line a="tagline">
          <span className="cx-mute">Use the database the app already owns.</span>
        </Line>
      </h2>
      <div
        className="cx-abs"
        data-a="footer"
        style={{ left: 160, right: 160, top: 840, display: "flex", gap: 16 }}
      >
        <span className="cx-chip">Effect-native</span>
        <span className="cx-chip">Open source · MIT</span>
        <span className="cx-chip">PostgreSQL · SQLite · libSQL · D1</span>
      </div>
    </Scene>
  ),
};
