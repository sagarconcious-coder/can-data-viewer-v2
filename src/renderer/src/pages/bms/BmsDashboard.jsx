import React from "react";
import PageHeader, { StatTile } from "../../components/PageHeader.jsx";
import { CellBarChart, TrendLineChart } from "../../components/LiveChart.jsx";
import BatteryGauge from "../../components/BatteryGauge.jsx";
import RingGauge from "../../components/RingGauge.jsx";
import { selectCellArrays } from "../../lib/canDecoder.js";
import protocol from "../../../../shared/protocol.js";

const { packCurrentStateArray, FaultArray, alarmArray } = protocol;

const CELL_COLORS = { max: "#26bc39", min: "#800080", normal: "#037ff3" };
// Matches BALANCING_FLASH_COLOR in the legacy app's UpdateUI.js. The legacy
// app flashed this via a one-shot setTimeout per newly-set bit; here it's
// simpler and equally visible to just recolor on every CELL_BALANCING frame
// (0x18963270, arrives repeatedly for as long as a cell is actively
// balancing), since React already re-renders the chart on each liveData
// update - no separate timer bookkeeping needed.
const BALANCING_COLOR = "#ffa500";

export default function BmsDashboard({ liveData, dataStatus, connection }) {
  const {
    batteryVoltage,
    current,
    soc,
    avrgCellTemp,
    avrgCellVolt,
    maxCellVolt,
    minCellVolt,
    maxCellTemp,
    minCellTemp,
    disFET,
    chgFET,
    soh,
    sop,
    availableCapacity,
    cyclesCount,
    fault,
    alarm,
    bmsPowerMode,
    packCurrentState,
    numberOfCell,
    numOfTemp,
    cellVoltageArray,
    cellTemperatureArray,
    bmsModelId,
    firmwareVersion,
    bmsHardwareVersion,
    pduHardwareVersion,
    batterySerialArray,
    batterySerialInt,
    year,
    month,
    day,
    hour,
    minutes,
    seconds,
    cellBalancing,
    balancingStatus,
    icTemperatureArray,
    pduTemperatureArray,
    heatSinkTemperatureArray,
  } = liveData;

  const balancingArray = cellBalancing?.array;
  const { cellVoltages: selectedVoltages, cellTemps } = selectCellArrays(liveData);
  const cellVoltages = selectedVoltages.filter((v) => v !== undefined);
  const cellVoltageColors = cellVoltages.map((v, i) =>
    balancingArray?.[i]
      ? BALANCING_COLOR
      : v === maxCellVolt
        ? CELL_COLORS.max
        : v === minCellVolt
          ? CELL_COLORS.min
          : CELL_COLORS.normal,
  );
  const balancingCount = balancingArray ? balancingArray.filter(Boolean).length : 0;
  const maxT = Math.max(...cellTemps.filter((t) => t !== 0));
  const minT = Math.min(...cellTemps.filter((t) => t !== 0));
  const cellTempColors = cellTemps.map((t) =>
    t === maxT ? CELL_COLORS.max : t === minT ? CELL_COLORS.min : CELL_COLORS.normal,
  );

  // AFE IC / PDU / MOSFET heatsink board temps - ported from renderer.js
  // (IC1Temp/IC2Temp, PDUTemp/PCBTemp2, HeatSink1Temp/HeatSink2Temp), decoded
  // in canDecoder.js's TEMP_1 case but previously not shown anywhere.
  const boardTemps = [
    { label: "AFE IC 1", value: icTemperatureArray?.[0] ?? 0 },
    { label: "AFE IC 2", value: icTemperatureArray?.[1] ?? 0 },
    { label: "PDU", value: pduTemperatureArray?.[0] ?? 0 },
    { label: "PCB", value: pduTemperatureArray?.[1] ?? 0 },
    { label: "MOSFET Heatsink 1", value: heatSinkTemperatureArray?.[0] ?? 0 },
    { label: "MOSFET Heatsink 2", value: heatSinkTemperatureArray?.[1] ?? 0 },
  ];

  const timestamp =
    year || month || day ? `${day}/${month}/${year} ${hour}:${minutes}:${seconds}` : "—";

  return (
    <div className="page-container">
      <PageHeader
        title="BMS Live Dashboard"
        subtitle={`Data Status timestamp (from device): ${timestamp}`}
        dataStatus={dataStatus}
      />

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--warning)", fontWeight: 600 }}>
            <span>⚠</span> Not connected to a serial port. Connect from the sidebar to see live values.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 18px", flex: "0 0 auto" }}>
          <BatteryGauge value={soc} charging={!!chgFET} width={72} />
        </div>
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, padding: "10px 18px", flex: "0 0 auto" }}>
          <RingGauge value={soh} label="SOH" size={72} />
          <RingGauge value={sop} label="SOP" size={72} />
        </div>
        <div className="stat-tile-row" style={{ flex: 1 }}>
          <StatTile compact label="Battery Voltage" value={batteryVoltage.toFixed(2)} unit="V" />
          <StatTile compact label="Current" value={current.toFixed(2)} unit="A" />
          <StatTile compact label="Power" value={(batteryVoltage * current).toFixed(2)} unit="W" />
          <StatTile compact label="Capacity" value={availableCapacity} unit="Ah" />
          <StatTile compact label="Cycles" value={cyclesCount} unit="" />
          <StatTile compact label="Pack State" value={packCurrentStateArray[packCurrentState] ?? packCurrentState} unit="" />
        </div>
      </div>

      <div className="grid grid-4" style={{ gap: 12 }}>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="card-title" style={{ fontSize: 11.5, marginBottom: 8 }}>FET / Status</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <LightRow label="Discharge FET" on={disFET} />
            <LightRow label="Charge FET" on={chgFET} />
            <LightRow label="Balancing" on={balancingStatus} />
          </div>
        </div>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="card-title" style={{ fontSize: 11.5, marginBottom: 8 }}>Power / Faults</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row label="Power Mode" value={["Active", "Sleep", "Deep Sleep", "Sleep Wake Up"][bmsPowerMode] ?? bmsPowerMode} />
            <Row label="Fault" value={fault != null ? (FaultArray[fault] ?? fault) : "—"} />
            <Row label="Alarm" value={alarm != null ? (alarmArray[alarm] ?? alarm) : "—"} />
          </div>
        </div>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="card-title" style={{ fontSize: 11.5, marginBottom: 8 }}>Device Info</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row label="Model" value={bmsModelId || "—"} />
            <Row label="Firmware" value={firmwareVersion || "—"} />
            <Row label="Hardware" value={`${pduHardwareVersion || "—"} / ${bmsHardwareVersion || "—"}`} />
            <Row
              label="Serial"
              value={batterySerialArray ? `${batterySerialArray}${batterySerialInt || ""}` : "—"}
            />
          </div>
        </div>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="card-title" style={{ fontSize: 11.5, marginBottom: 8 }}>MOSFET Heatsink</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row label="Heatsink 1" value={`${boardTemps[4].value} °C`} />
            <Row label="Heatsink 2" value={`${boardTemps[5].value} °C`} />
          </div>
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
            { color: CELL_COLORS.max, label: "Highest" },
            { color: CELL_COLORS.min, label: "Lowest" },
            { color: CELL_COLORS.normal, label: "Normal" },
            { color: BALANCING_COLOR, label: "Balancing" },
          ]}
        />

        <div className="stat-tile-row">
          <StatTile compact label="Avg Cell Voltage" value={avrgCellVolt} unit="mV" />
          <StatTile compact label="Max Cell Voltage" value={maxCellVolt} unit="mV" />
          <StatTile compact label="Min Cell Voltage" value={minCellVolt} unit="mV" />
          <StatTile compact label="Cell Count" value={cellVoltages.length} unit="" />
          <StatTile compact label="Avg Cell Temp" value={avrgCellTemp} unit="°C" />
          <StatTile compact label="Max Cell Temp" value={maxCellTemp} unit="°C" />
          <StatTile compact label="Min Cell Temp" value={minCellTemp} unit="°C" />
          <StatTile compact label="Temp Sensors" value={cellTemps.filter((t) => t).length} unit="" />
        </div>

        <div className="grid grid-2">
          <div>
            <div className="card-title">Cell Voltages</div>
            {cellVoltages.length > 0 ? (
              <CellBarChart
                labels={cellVoltages.map((_, i) => `C${i + 1}`)}
                values={cellVoltages}
                colors={cellVoltageColors}
                unit="mV"
              />
            ) : (
              <EmptyChart text="No cell voltage data yet" />
            )}
          </div>
          <div>
            <div className="card-title">Cell Temperatures</div>
            {cellTemps.some((t) => t) ? (
              <CellBarChart
                labels={cellTemps.map((_, i) => `T${i + 1}`)}
                values={cellTemps}
                colors={cellTempColors}
                unit="°C"
              />
            ) : (
              <EmptyChart text="No temperature data yet" />
            )}
          </div>
        </div>

        <div>
          <div className="card-title">Board Temperatures (AFE IC / PDU / MOSFET Heatsink)</div>
          {boardTemps.some((t) => t.value !== 0) ? (
            <CellBarChart
              labels={boardTemps.map((t) => t.label)}
              values={boardTemps.map((t) => t.value)}
              colors={boardTemps.map(() => "#e0a53f")}
              unit="°C"
            />
          ) : (
            <EmptyChart text="No board temperature data yet" />
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Battery Voltage Trend</div>
          <TrendLineChart label="Voltage" value={batteryVoltage} color="#2f6fed" unit="V" />
        </div>
        <div className="card">
          <div className="card-title">Current Trend</div>
          <TrendLineChart label="Current" value={current} color="#e0a53f" unit="A" />
        </div>
      </div>
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

function LightRow({ label, on }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className={`light-dot ${on ? "on" : ""}`} />
    </div>
  );
}

/** Small color-key row explaining what each bar color means in the cell voltage/temperature charts below. */
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

function EmptyChart({ text }) {
  return (
    <div className="empty-state" style={{ padding: 30 }}>
      <span className="empty-icon">📊</span>
      <span>{text}</span>
    </div>
  );
}
