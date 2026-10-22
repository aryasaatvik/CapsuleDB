import type { SceneMarkup } from "../../scene";
import { Kicker, Line, Mark, Scene, Wordmark } from "../parts";

/** The mark seals, the wordmark lands, and the promise is stated once. */
export const reveal: SceneMarkup = {
  id: "reveal",
  render: (size) => (
    <Scene size={size}>
      <div
        className="cx-abs"
        style={{ left: 160, top: 250, display: "flex", alignItems: "center", gap: 44 }}
      >
        <Mark height={150} a="mark" />
        <span className="cx-mask">
          <span data-a="wordmark">
            <Wordmark size={172} />
          </span>
        </span>
      </div>
      <h2 className="cx-h cx-abs" style={{ left: 160, top: 530, fontSize: 76, fontWeight: 640 }}>
        <Line a="tagline">Ship persistence with your package.</Line>
        <Line a="tagline">
          <span style={{ color: "var(--cx-soft)" }}>Use the database the app already owns.</span>
        </Line>
      </h2>
      <div
        className="cx-abs"
        data-a="footer"
        style={{ left: 160, right: 160, top: 860, display: "flex", gap: 48 }}
      >
        <Kicker>Effect-native</Kicker>
        <Kicker>Open source · MIT</Kicker>
        <Kicker>PostgreSQL · SQLite · libSQL · D1</Kicker>
      </div>
    </Scene>
  ),
};
