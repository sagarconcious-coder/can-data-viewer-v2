import React, { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";

/**
 * Parallel pack view. The legacy app merges three different frame types
 * (0x14F3xx voltage/SOC, 0x14F4xx current/state, 0x14F6xx min/max cell
 * voltage) keyed by batteryPackId into arrayOfBatteryPackInParallel. Here we
 * keep a small local merge table keyed the same way, fed by liveData.parallel
 * patches emitted from canDecoder.js.
 */
export default function BmsParallel({ liveData, dataStatus }) {
  const [packs, setPacks] = useState({});

  useEffect(() => {
    if (!liveData.parallel) return;
    setPacks((prev) => {
      const id = liveData.parallel.batteryPackId;
      const existing = prev[id] || {};
      return { ...prev, [id]: { ...existing, ...liveData.parallel } };
    });
  }, [liveData.parallel]);

  const packIds = Object.keys(packs);

  return (
    <div className="page-container">
      <PageHeader
        title="Parallel View"
        subtitle="Live status of multiple battery packs wired in parallel, merged by pack ID."
        dataStatus={dataStatus}
      />

      {packIds.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-icon">‖</span>
            <span>No parallel pack frames received yet. This view populates automatically when multiple packs broadcast on the bus.</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-3">
          {packIds.map((id) => {
            const p = packs[id];
            return (
              <div className="card" key={id}>
                <div className="card-title">Pack #{id}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Row label="Voltage" value={p.batteryVoltage !== undefined ? `${p.batteryVoltage} V` : "—"} />
                  <Row label="Current" value={p.current !== undefined ? `${p.current} A` : "—"} />
                  <Row label="SOC" value={p.soc !== undefined ? `${p.soc} %` : "—"} />
                  <Row label="Max Temp" value={p.maxTemperature ?? "—"} />
                  <Row label="Min Temp" value={p.minTemperature ?? "—"} />
                  <Row label="Max Cell Voltage" value={p.maxCellVoltage !== undefined ? `${p.maxCellVoltage} mV` : "—"} />
                  <Row label="Min Cell Voltage" value={p.minCellVoltage !== undefined ? `${p.minCellVoltage} mV` : "—"} />
                  <Row label="Pack State" value={p.packState ?? "—"} />
                  <Row label="Fault" value={p.fault ?? "—"} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}
