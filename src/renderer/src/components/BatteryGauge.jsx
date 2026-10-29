import React from "react";

/**
 * SOC shown as an actual battery icon (body + terminal nub) with a fill level
 * proportional to charge, instead of a plain numeric stat tile - easier to
 * read at a glance than "State of Charge: 82 %" in a grid of similar tiles.
 * Fill color shifts red/amber/green by charge level, matching the same
 * traffic-light convention used elsewhere in the dashboard (min/max cell
 * coloring, warning severities).
 */
export default function BatteryGauge({ value = 0, charging = false, width = 120 }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const color = pct <= 15 ? "var(--danger)" : pct <= 35 ? "var(--warning)" : "var(--success)";

  // Body interior is a fixed cell in the viewBox; fillWidth scales with pct.
  const bodyX = 4;
  const bodyY = 8;
  const bodyW = 92;
  const bodyH = 44;
  const padding = 4;
  const innerW = bodyW - padding * 2;
  const fillW = (innerW * pct) / 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={width} viewBox="0 0 104 60" role="img" aria-label={`Battery ${pct}% charged`}>
        {/* terminal nub */}
        <rect x={96} y={22} width={6} height={16} rx={2} fill="var(--text-faint)" />
        {/* outer shell */}
        <rect
          x={bodyX}
          y={bodyY}
          width={bodyW}
          height={bodyH}
          rx={8}
          fill="none"
          stroke="var(--text-faint)"
          strokeWidth={3}
        />
        {/* fill level */}
        <rect
          x={bodyX + padding}
          y={bodyY + padding}
          width={Math.max(0, fillW)}
          height={bodyH - padding * 2}
          rx={4}
          fill={color}
          style={{ transition: "width 0.4s ease, fill 0.4s ease" }}
        />
        {/* charging bolt overlay */}
        {charging && (
          <path
            d="M54 14 L40 34 L50 34 L46 50 L64 28 L53 28 Z"
            fill="var(--bg-elevated)"
            stroke="var(--text)"
            strokeWidth={1}
          />
        )}
      </svg>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color }}>{pct}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>% SOC</span>
      </div>
    </div>
  );
}
