import React from "react";
import PageHeader, { StatTile } from "../../components/PageHeader.jsx";
import { TrendLineChart, CellBarChart } from "../../components/LiveChart.jsx";
import BatteryGauge from "../../components/BatteryGauge.jsx";
import { selectCellArrays } from "../../lib/canDecoder.js";

/**
 * RBMS shares the same live heartbeat/cell/temperature CAN IDs as BMS at the
 * protocol level (dataOperation() in the legacy app has no device-type branch
 * for live telemetry, only for configuration fetch), so the RBMS dashboard
 * reads from the same liveData shape, styled with the RBMS (purple/amber)
 * accent per the UI requirement to give each mode a distinct identity.
 */
// Matches BALANCING_FLASH_COLOR in the legacy app's UpdateUI.js.
const BALANCING_COLOR = "#ffa500";

export default function RbmsDashboard({ liveData, dataStatus, connection }) {
  const {
    batteryVoltage,
    current,
    soc,
    avrgCellTemp,
    avrgCellVolt,
    maxCellVolt,
    minCellVolt,
    numberOfCell,
    numOfTemp,
    cellVoltageArray,
    cellTemperatureArray,
    bmsModelId,
    firmwareVersion,
    cellBalancing,
  } = liveData;

  const balancingArray = cellBalancing?.array;
  const { cellVoltages, cellTemps } = selectCellArrays(liveData);
  const cellVoltageColors = cellVoltages.map((v, i) =>
    balancingArray?.[i] ? BALANCING_COLOR : v === maxCellVolt ? "#26bc39" : v === minCellVolt ? "#800080" : "#8a4fe0",
  );
  const balancingCount = balancingArray ? balancingArray.filter(Boolean).length : 0;

  return (
    <div className="page-container">
      <PageHeader title="RBMS Live Dashboard" subtitle="Rack BMS live telemetry" dataStatus={dataStatus} />

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Not connected. Connect from the sidebar to see live values.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 18px", flex: "0 0 auto" }}>
          <BatteryGauge value={soc} width={72} />
        </div>
        <div className="stat-tile-row" style={{ flex: 1 }}>
          <StatTile compact label="Battery Voltage" value={batteryVoltage.toFixed(2)} unit="V" />
          <StatTile compact label="Current" value={current.toFixed(2)} unit="A" />
          <StatTile compact label="Model" value={bmsModelId || "—"} unit="" />
          <StatTile compact label="Firmware" value={firmwareVersion || "—"} unit="" />
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
          Cell Information
          {balancingCount > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: BALANCING_COLOR,
                border: `1px solid ${BALANCING_COLOR}`,
                borderRadius: 999,
                padding: "1px 8px",
              }}
            >
              ⚡ Balancing {balancingCount} cell{balancingCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <ColorLegend
          items={[
            { color: "#26bc39", label: "Highest" },
            { color: "#800080", label: "Lowest" },
            { color: "#8a4fe0", label: "Normal" },
            { color: BALANCING_COLOR, label: "Balancing" },
          ]}
        />

        <div className="stat-tile-row">
          <StatTile compact label="Avg Cell Voltage" value={avrgCellVolt} unit="mV" />
          <StatTile compact label="Max Cell Voltage" value={maxCellVolt} unit="mV" />
          <StatTile compact label="Min Cell Voltage" value={minCellVolt} unit="mV" />
          <StatTile compact label="Cell Count" value={cellVoltages.length || numberOfCell} unit="" />
          <StatTile compact label="Avg Cell Temp" value={avrgCellTemp} unit="°C" />
        </div>

        <div className="grid grid-2">
          <div>
            <div className="card-title">Cell Voltages</div>
            {cellVoltages.some((v) => v) ? (
              <CellBarChart
                labels={cellVoltages.map((_, i) => `C${i + 1}`)}
                values={cellVoltages}
                colors={cellVoltageColors}
                unit="mV"
              />
            ) : (
              <div className="empty-state" style={{ padding: 30 }}>
                <span className="empty-icon">📊</span>
                <span>No cell voltage data yet</span>
              </div>
            )}
          </div>
          <div>
            <div className="card-title">Cell Temperatures</div>
            {cellTemps.some((t) => t) ? (
              <CellBarChart
                labels={cellTemps.map((_, i) => `T${i + 1}`)}
                values={cellTemps}
                colors={cellTemps.map(() => "#8a4fe0")}
                unit="°C"
              />
            ) : (
              <div className="empty-state" style={{ padding: 30 }}>
                <span className="empty-icon">📊</span>
                <span>No temperature data yet</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Battery Voltage Trend</div>
          <TrendLineChart label="Voltage" value={batteryVoltage} color="#8a4fe0" unit="V" />
        </div>
        <div className="card">
          <div className="card-title">Current Trend</div>
          <TrendLineChart label="Current" value={current} color="#e0a53f" unit="A" />
        </div>
      </div>
    </div>
  );
}

/** Small color-key row explaining what each bar color means in the cell voltage chart above. */
function ColorLegend({ items }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: item.color,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
