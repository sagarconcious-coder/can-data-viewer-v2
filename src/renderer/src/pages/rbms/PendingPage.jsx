import React from "react";
import PageHeader from "../../components/PageHeader.jsx";

/**
 * Placeholder for RBMS sidebar entries whose CAN commands/frames aren't
 * defined yet. Swap the route over to a real page once the packet format is
 * available.
 */
export default function PendingPage({ title, subtitle, dataStatus }) {
  return (
    <div className="page-container">
      <PageHeader title={title} subtitle={subtitle} dataStatus={dataStatus} />
      <div className="card">
        <div className="empty-state" style={{ padding: 40 }}>
          <span className="empty-icon">🛠</span>
          <span style={{ fontWeight: 700 }}>Not available yet</span>
          <span>This page is waiting for its CAN packet format. Share the command sheet to enable it.</span>
        </div>
      </div>
    </div>
  );
}
