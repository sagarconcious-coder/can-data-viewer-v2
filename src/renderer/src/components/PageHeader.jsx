import React from "react";
import { DataLiveBadge } from "./StatusBadge.jsx";

export default function PageHeader({ title, subtitle, dataStatus, right }) {
  return (
    <div className="page-header">
      <div>
        <div className="page-title">{title}</div>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {dataStatus && <DataLiveBadge live={dataStatus.live} lastUpdate={dataStatus.lastUpdate} />}
        {right}
      </div>
    </div>
  );
}

export function StatTile({ label, value, unit, compact }) {
  return (
    <div className={compact ? "stat-tile stat-tile-compact" : "stat-tile"}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value} {unit && <span className="stat-unit">{unit}</span>}
      </span>
    </div>
  );
}
