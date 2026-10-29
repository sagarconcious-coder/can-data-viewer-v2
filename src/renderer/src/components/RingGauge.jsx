import React from "react";

/**
 * Compact circular percentage gauge - same visual language as BatteryGauge
 * (traffic-light color by severity, big bold percentage, small caption below)
 * but for percentage-only readings like SOH/SOP that aren't literally a
 * battery fill. Sized to sit inline in the same stat strip as BatteryGauge
 * and the plain StatTiles rather than as a full standalone card.
 */
export default function RingGauge({ value = 0, label, size = 72, thresholds = { danger: 15, warning: 35 } }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const color = pct <= thresholds.danger ? "var(--danger)" : pct <= thresholds.warning ? "var(--warning)" : "var(--success)";

  const strokeWidth = 7;
  const r = 50 - strokeWidth / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct / 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label} ${pct}%`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.4s ease" }}
        />
        <text
          x="50"
          y="47"
          textAnchor="middle"
          fontSize="26"
          fontWeight="800"
          fill={color}
          fontFamily="inherit"
        >
          {pct}
        </text>
        <text x="50" y="66" textAnchor="middle" fontSize="12" fill="var(--text-muted)" fontFamily="inherit">
          %
        </text>
      </svg>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
    </div>
  );
}
