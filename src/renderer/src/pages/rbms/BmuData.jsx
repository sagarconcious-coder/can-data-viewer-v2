import React, { useEffect, useRef, useState } from "react";
import PageHeader, { StatTile } from "../../components/PageHeader.jsx";
import { CellBarChart } from "../../components/LiveChart.jsx";
import RingGauge from "../../components/RingGauge.jsx";
import { selectCellArrays } from "../../lib/canDecoder.js";
import { sendBmuToolCommand } from "../../lib/canCommands.js";
import { useToast } from "../../lib/toast.jsx";
import protocol from "../../../../shared/protocol.js";

const { BMU_TOOL_CMD, BMU_ADDRESS_PASS } = protocol;

// Same balancing orange as the dashboards (BALANCING_FLASH_COLOR in the legacy app).
const BALANCING_COLOR = "#ffa500";
// Bar colors from RbmsDashboard.jsx, so both pages read the same way.
const CELL_COLORS = { max: "#26bc39", min: "#800080", normal: "#8a4fe0" };
// The tool can take several seconds to finish addressing, so wait at least 15 s
// before reporting "no response".
const ADDRESSING_TIMEOUT_MS = 15000;
// After Stop Data, wait this long and then check whether frames are still
// arriving. "Stopped" = no frame at all in the last STOP_QUIET_MS, which
// tolerates the few frames already in flight when the stop was sent.
const STOP_CHECK_DELAY_MS = 2000;
const STOP_QUIET_MS = 1000;

// The tool never reports FAN state or whether data was started, so the page
// remembers what it last commanded. Module-level so it survives navigating
// away and back (the page component itself is unmounted on route change).
const commanded = { fan: null, dataStarted: false, fanLocked: false };

/**
 * Per-BMU view for RBMS mode: pack voltage, SoC/SoH, cell voltage / temperature
 * grids, BMU identity and balancing status, all read from the shared liveData shape.
 *
 * Addressing / start data / FAN go out on the BMU tool ID (974261, see
 * BMU_TOOL_ID in protocol.js). Start Data sends only the addressing request
 * (no separate start-data command); Stop Data and FAN stay disabled until the
 * response reports Address IN as pass.
 */
export default function BmuData({ liveData, dataStatus, connection, resetLiveData }) {
  const showToast = useToast();

  // "Pause" freezes the view on the last snapshot so values can be read or
  // screenshotted without them ticking; incoming frames still update liveData.
  const [paused, setPaused] = useState(false);
  const [snapshot, setSnapshot] = useState(liveData);
  useEffect(() => {
    if (!paused) setSnapshot(liveData);
  }, [liveData, paused]);
  const d = paused ? snapshot : liveData;

  // Addressing state always reads the live data, never the paused snapshot.
  const { bmuAddressIn, bmuAddressOut, bmuAddressAt } = liveData;
  const [addressingSentAt, setAddressingSentAt] = useState(0);
  const [fanState, setFanState] = useState(commanded.fan);
  const [dataStarted, setDataStarted] = useState(commanded.dataStarted);
  // Set when a Stop Data was confirmed (data really stopped); FAN stays
  // disabled until the next Start Data.
  const [fanLocked, setFanLocked] = useState(commanded.fanLocked);
  const [stopChecking, setStopChecking] = useState(false);
  const stopTimerRef = useRef(null);
  // Latest frame time, readable from inside the stop-check timer.
  const lastFrameRef = useRef(dataStatus.lastUpdate);
  lastFrameRef.current = dataStatus.lastUpdate;
  useEffect(() => () => clearTimeout(stopTimerRef.current), []);
  const awaitingAddress = addressingSentAt > 0 && bmuAddressAt < addressingSentAt;

  useEffect(() => {
    if (!awaitingAddress) return undefined;
    const timer = setTimeout(() => {
      setAddressingSentAt(0);
      showToast("No addressing response. Check the tool is in BMU mode.", "failure");
    }, ADDRESSING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [awaitingAddress, showToast]);

  // Start Data only sends the addressing request; the BMU starts its data on
  // its own once addressing passes, so no separate start-data command is sent.
  useEffect(() => {
    if (addressingSentAt && bmuAddressAt >= addressingSentAt) {
      setAddressingSentAt(0);
      if (bmuAddressIn === BMU_ADDRESS_PASS) {
        commanded.dataStarted = true;
        setDataStarted(true);
        showToast("Address IN passed - data started", "success");
      } else {
        showToast("Address IN failed - data not started", "failure");
      }
    }
  }, [bmuAddressAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const connected = connection.status.connected;
  const addressInPass = bmuAddressIn === BMU_ADDRESS_PASS;
  const gatedTitle = addressInPass ? undefined : "Press Start Data first - Address IN must pass";
  const fanDisabled = !connected || !addressInPass || fanLocked;
  const fanTitle = fanLocked ? "Data was stopped - press Start Data to enable FAN" : gatedTitle;

  const startData = async () => {
    // Fresh start: clear every value on screen (cells, pack, address status)
    // and the remembered FAN / data state before asking for addressing.
    resetLiveData();
    setPaused(false);
    clearTimeout(stopTimerRef.current);
    setStopChecking(false);
    commanded.fan = null;
    commanded.dataStarted = false;
    commanded.fanLocked = false;
    setFanState(null);
    setDataStarted(false);
    setFanLocked(false);
    setAddressingSentAt(Date.now());
    const result = await sendBmuToolCommand(BMU_TOOL_CMD.ADDRESSING, 1);
    if (!result?.success) {
      setAddressingSentAt(0);
      showToast("Failed to send start request", "failure");
    }
  };

  // Stop Data: send [2, 0], wait 2 s, then check whether frames stopped.
  // Stopped -> disable FAN ON/OFF. Still coming -> leave everything enabled.
  const stopData = async () => {
    const result = await sendBmuToolCommand(BMU_TOOL_CMD.START_DATA, 0);
    if (!result?.success) {
      showToast("Failed to send stop data request", "failure");
      return;
    }
    setStopChecking(true);
    clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      setStopChecking(false);
      const last = lastFrameRef.current;
      const stopped = !last || Date.now() - last > STOP_QUIET_MS;
      if (stopped) {
        commanded.dataStarted = false;
        commanded.fanLocked = true;
        setDataStarted(false);
        setFanLocked(true);
        showToast("Data stopped - FAN controls disabled", "success");
      } else {
        showToast("Data is still coming - nothing disabled", "info");
      }
    }, STOP_CHECK_DELAY_MS);
  };

  const setFan = async (on) => {
    const result = await sendBmuToolCommand(BMU_TOOL_CMD.FAN, on ? 1 : 0);
    if (result?.success) {
      commanded.fan = on;
      setFanState(on);
      showToast(`FAN ${on ? "ON" : "OFF"} request sent`, "success");
    } else {
      showToast(`Failed to send FAN ${on ? "ON" : "OFF"} request`, "failure");
    }
  };

  const {
    batteryVoltage,
    soc,
    soh,
    avrgCellVolt,
    avrgCellTemp,
    maxCellVolt,
    minCellVolt,
    maxCellTemp,
    minCellTemp,
    numberOfCell,
    numOfTemp,
    cellBalancing,
    balancingStatus,
    bmsModelId,
    firmwareVersion,
    bmsHardwareVersion,
    batterySerialArray,
    batterySerialInt,
  } = d;

  const { cellVoltages, cellTemps } = selectCellArrays(d);
  const hasVoltages = cellVoltages.some((v) => v);
  const hasTemps = cellTemps.some((t) => t);
  const balancingArray = cellBalancing?.array;
  const balancingCount = balancingArray ? balancingArray.filter(Boolean).length : 0;

  const cellVoltageColors = cellVoltages.map((v, i) =>
    balancingArray?.[i]
      ? BALANCING_COLOR
      : v === maxCellVolt
        ? CELL_COLORS.max
        : v === minCellVolt
          ? CELL_COLORS.min
          : CELL_COLORS.normal,
  );

  const serial = batterySerialArray ? `${batterySerialArray}${batterySerialInt || ""}` : "—";

  return (
    <div className="page-container">
      <PageHeader
        title="BMU Data"
        subtitle="Live BMU telemetry: pack values, per-cell voltages and temperatures, status flags."
        dataStatus={dataStatus}
        right={
          <button className="btn btn-ghost" onClick={() => setPaused((p) => !p)} title="Freeze the screen; sends nothing">
            {paused ? "▶ Resume View" : "⏸ Pause View"}
          </button>
        }
      />

      {/* Device controls */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <ActionButton
          color="#1f6fe5"
          icon={<PlayIcon />}
          label={awaitingAddress ? "Addressing…" : "Start Data"}
          onClick={startData}
          disabled={!connected || awaitingAddress}
          active={dataStarted}
        />
        <ActionButton
          color="#e14b4b"
          icon={<StopIcon />}
          label={stopChecking ? "Checking…" : "Stop Data"}
          onClick={stopData}
          disabled={!connected || !addressInPass || stopChecking}
          title={gatedTitle}
        />
        <ActionButton
          color="#1f6fe5"
          icon={<FanIcon />}
          label="FAN ON"
          onClick={() => setFan(true)}
          disabled={fanDisabled}
          active={fanState === true}
          title={fanTitle}
        />
        <ActionButton
          color="#5b6576"
          icon={<FanIcon />}
          label="FAN OFF"
          onClick={() => setFan(false)}
          disabled={fanDisabled}
          active={fanState === false}
          title={fanTitle}
        />
        {!addressInPass && connected && (
          <span style={{ alignSelf: "center", fontSize: 12.5, color: "var(--text-muted)" }}>
            Press Start Data first - Stop Data and FAN unlock once Address IN passes.
          </span>
        )}
        {addressInPass && fanLocked && connected && (
          <span style={{ alignSelf: "center", fontSize: 12.5, color: "var(--text-muted)" }}>
            Data stopped - press Start Data to use FAN again.
          </span>
        )}
      </div>

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Not connected. Connect from the sidebar to see live values.</div>
        </div>
      )}

      {paused && (
        <div className="card" style={{ borderColor: "var(--accent)", padding: "10px 14px" }}>
          <div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>
            ⏸ View paused. Showing the snapshot from when you paused. Press Resume to continue live updates.
          </div>
        </div>
      )}

      {/* Address status */}
      <div className="grid grid-2" style={{ gap: 12 }}>
        <LinkChip
          icon="⇥"
          label="Address IN"
          state={bmuAddressIn == null ? null : addressInPass}
          pending={awaitingAddress}
        />
        <LinkChip
          icon="⇤"
          label="Address OUT"
          state={bmuAddressOut == null ? null : bmuAddressOut === BMU_ADDRESS_PASS}
          pending={awaitingAddress}
        />
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Kpi label="Pack Voltage" value={batteryVoltage.toFixed(1)} unit="V" sub={`Avg cell ${fmtV(avrgCellVolt)} V`} />
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-around", padding: "12px 10px" }}>
          <RingGauge value={soc} label="SoC" size={78} />
          <RingGauge value={soh} label="SoH" size={78} thresholds={{ danger: 60, warning: 80 }} />
        </div>
      </div>

      {/* Cells - same layout as the RBMS Live Dashboard */}
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
          <StatTile compact label="Cell Count" value={cellVoltages.length || numberOfCell} unit="" />
          <StatTile compact label="Avg Cell Temp" value={avrgCellTemp} unit="°C" />
          <StatTile compact label="Max Cell Temp" value={maxCellTemp} unit="°C" />
          <StatTile compact label="Min Cell Temp" value={minCellTemp} unit="°C" />
        </div>

        <div className="grid grid-2">
          <div>
            <div className="card-title">Cell Voltages</div>
            {hasVoltages ? (
              <CellBarChart
                labels={cellVoltages.map((_, i) => `C${i + 1}`)}
                values={cellVoltages}
                colors={cellVoltageColors}
                unit="mV"
              />
            ) : (
              <Empty text="No cell voltage data yet" />
            )}
          </div>
          <div>
            <div className="card-title">Cell Temperatures</div>
            {hasTemps ? (
              <CellBarChart
                labels={cellTemps.map((_, i) => `T${i + 1}`)}
                values={cellTemps}
                colors={cellTemps.map(() => CELL_COLORS.normal)}
                unit="°C"
              />
            ) : (
              <Empty text="No temperature data yet" />
            )}
          </div>
        </div>
      </div>

      {/* Details / status */}
      <div className="grid grid-2" style={{ gap: 12, alignItems: "start" }}>
        <div className="card">
          <div className="card-title">BMU Details</div>
          <KvList
            rows={[
              ["Model ID", bmsModelId || "—"],
              ["Firmware", firmwareVersion || "—"],
              ["Hardware", bmsHardwareVersion || "—"],
              ["Serial Number", serial],
              ["Cells / Temperature", `${cellVoltages.length || numberOfCell || "—"} / ${cellTemps.length || numOfTemp || "—"}`],
            ]}
          />
        </div>

        <div className="card">
          <div className="card-title">Status Indicators</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Indicator label="Cell Balancing" on={balancingStatus || balancingCount > 0} />
          </div>
        </div>

      </div>
    </div>
  );
}


function fmtV(mv) {
  return mv ? (mv / 1000).toFixed(3) : "—";
}

function ActionButton({ color, icon, label, onClick, disabled, active, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        minWidth: 150,
        height: 48,
        padding: "0 22px",
        border: "none",
        borderRadius: 8,
        background: color,
        color: "white",
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: "0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        boxShadow: active ? `0 0 0 3px var(--bg), 0 0 0 5px ${color}` : "0 2px 6px rgba(0, 0, 0, 0.15)",
        transition: "box-shadow 0.15s ease, opacity 0.15s ease, filter 0.15s ease",
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.filter = "brightness(1.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
    >
      {icon}
      {label}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function FanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor">
        <path d="M12 10.2c-.4-2.6.3-6.2 3-7 2.4-.7 4 1.6 3 3.5-.9 1.8-3.4 2.4-6 3.5z" />
        <path d="M13.6 13c2.4 1 4.9 3.7 4.1 6.4-.7 2.4-3.5 2.4-4.5.5-.9-1.8-.2-4.3.4-6.9z" />
        <path d="M10.4 12.8c-2.1 1.6-5.6 2.7-7.6.8-1.8-1.7-.6-4.3 1.5-4.4 2-.1 3.9 1.7 6.1 3.6z" />
        <circle cx="12" cy="12" r="1.8" />
      </g>
    </svg>
  );
}

function LinkChip({ icon, label, state, pending, okText = "PASS", badText = "FAIL" }) {
  const known = !pending && (state === true || state === false);
  const color = !known ? "var(--text-faint)" : state ? "var(--success)" : "var(--danger)";
  const bg = !known ? "var(--bg-sunken)" : state ? "var(--success-bg)" : "var(--danger-bg)";
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: bg,
          color,
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ fontWeight: 700, flex: 1 }}>{label}</span>
      <span
        style={{
          padding: "4px 12px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.04em",
          color,
          background: bg,
          border: `1px solid ${color}`,
        }}
      >
        {pending ? "WAITING…" : !known ? "NOT RUN" : state ? okText : badText}
      </span>
    </div>
  );
}

function Kpi({ label, value, unit, sub }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px" }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {value} <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-muted)" }}>{unit}</span>
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</span>
    </div>
  );
}




function KvList({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map(([k, v]) => (
        <div
          key={k}
          style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "7px 0", borderBottom: "1px solid var(--border)" }}
        >
          <span style={{ color: "var(--text-muted)" }}>{k}</span>
          <span style={{ fontWeight: 700, textAlign: "right" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Indicator({ label, on }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
        {on ? "On" : "Off"}
        <span className={`light-dot ${on ? "on" : ""}`} />
      </span>
    </div>
  );
}


/** Small color-key row explaining what each bar color means in the cell charts. */
function ColorLegend({ items }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: item.color, display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="empty-state" style={{ padding: 30 }}>
      <span className="empty-icon">📊</span>
      <span>{text}</span>
    </div>
  );
}
