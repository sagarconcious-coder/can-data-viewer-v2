import React from "react";

export function StatusBadge({ connected }) {
  return (
    <span className={`badge ${connected ? "badge-success" : "badge-danger"}`}>
      <span className="badge-dot" />
      {connected ? "Connected" : "Disconnected"}
    </span>
  );
}

export function DataLiveBadge({ live, lastUpdate }) {
  if (!live) {
    return (
      <span className="badge badge-danger">
        <span className="badge-dot" />
        {lastUpdate ? `Not Live · ${new Date(lastUpdate).toLocaleTimeString()}` : "No Data"}
      </span>
    );
  }
  return (
    <span className="badge badge-success">
      <span className="badge-dot" />
      Live
    </span>
  );
}
