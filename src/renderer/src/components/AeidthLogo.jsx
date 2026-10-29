import React from "react";
import aeidthLogo from "../assets/aeidth-logo.png";
import aeidthIcon from "../assets/aeidth-icon.png";

/**
 * Real Aeidth brand mark. Two source assets, both cropped from the same
 * original artwork (transparent background):
 *  - aeidth-logo.png: full wordmark lockup (icon + "Aeidth" text), wide
 *    (~2.24:1) - used wherever there's horizontal room.
 *  - aeidth-icon.png: just the triangle icon, cropped out of the same
 *    artwork (~0.65:1, taller than wide) - used for icon-only slots like the
 *    sidebar's collapsed rail, where the full wordmark wouldn't fit.
 * Both are sized by `height` at their natural aspect ratio rather than
 * forced into a square box, so nothing gets stretched or cropped further.
 * `withWordmark` is kept for API compatibility with callers that used to
 * render a separate icon + text label - the full logo already includes the
 * wordmark, so it's a no-op when `icon` is false.
 */
export default function AeidthLogo({ size = 34, withWordmark = false, icon = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <img
        src={icon ? aeidthIcon : aeidthLogo}
        alt="Aeidth logo"
        style={{ flexShrink: 0, height: size, width: "auto" }}
      />
      {withWordmark && icon && (
        <span
          style={{
            fontWeight: 800,
            fontSize: Math.round(size * 0.5),
            letterSpacing: "-0.01em",
            color: "var(--text)",
            whiteSpace: "nowrap",
          }}
        >
          Aeidth
        </span>
      )}
    </div>
  );
}
