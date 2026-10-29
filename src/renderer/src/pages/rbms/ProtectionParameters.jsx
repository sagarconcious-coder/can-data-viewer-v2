import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import BmsConfiguration from "../bms/BmsConfiguration.jsx";
import BmsWarnings from "../bms/BmsWarnings.jsx";

const SECTIONS = [
  { key: "config", label: "Configuration Settings" },
  { key: "warning", label: "Warning Settings" },
];

/**
 * RBMS protection limits: the legacy app's Configuration Settings (161-byte
 * config struct) and Warning Settings tabs, combined under one page.
 */
export default function ProtectionParameters(props) {
  const [section, setSection] = useState("config");

  return (
    <div className="page-container">
      <PageHeader
        title="Protection Parameters"
        subtitle="RBMS configuration thresholds and warning/alarm limits."
        dataStatus={props.dataStatus}
      />

      <div className="tab-bar">
        {SECTIONS.map((s) => (
          <button key={s.key} className={section === s.key ? "active" : ""} onClick={() => setSection(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Both stay mounted so fetched values survive switching sections. */}
      <div style={{ display: section === "config" ? "contents" : "none" }}>
        <BmsConfiguration {...props} deviceType="rbms" embedded />
      </div>
      <div style={{ display: section === "warning" ? "contents" : "none" }}>
        <BmsWarnings {...props} embedded />
      </div>
    </div>
  );
}
