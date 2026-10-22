import type { SceneMarkup } from "../../scene";
import { Kicker, Mark, Scene, Wordmark } from "../parts";

/** Install line and repository, held to the last frame. */
export const cta: SceneMarkup = {
  id: "cta",
  render: (size) => (
    <Scene size={size}>
      <div
        className="cx-abs"
        style={{ left: 160, top: 250, display: "flex", alignItems: "center", gap: 40 }}
      >
        <Mark height={124} a="mark" />
        <span className="cx-mask">
          <span data-a="wordmark">
            <Wordmark size={144} />
          </span>
        </span>
      </div>
      <div
        data-a="install"
        className="cx-abs cx-mono"
        style={{
          left: 160,
          top: 500,
          height: 96,
          padding: "0 40px",
          display: "flex",
          alignItems: "center",
          gap: 22,
          borderRadius: 16,
          background: "var(--cx-code)",
          color: "var(--cx-code-ink)",
          fontSize: 44,
          fontWeight: 600,
        }}
      >
        <span style={{ color: "var(--cx-seal)" }}>$</span>
        bun add capsuledb
      </div>
      <p
        data-a="repo"
        className="cx-abs cx-mono"
        style={{ left: 160, top: 652, margin: 0, fontSize: 38, fontWeight: 600 }}
      >
        github.com/aryasaatvik/CapsuleDB
      </p>
      <div
        data-a="footer"
        className="cx-abs"
        style={{ left: 160, top: 860, display: "flex", gap: 48 }}
      >
        <Kicker>MIT license</Kicker>
        <Kicker>Effect 4</Kicker>
        <Kicker>Pre-1.0</Kicker>
      </div>
    </Scene>
  ),
};
