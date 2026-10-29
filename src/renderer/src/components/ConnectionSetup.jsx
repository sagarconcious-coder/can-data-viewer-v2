import React, { useState } from "react";
import { useSerialConnection } from "../hooks/useSerialConnection.js";
import { usePcanConnection } from "../hooks/usePcanConnection.js";
import { useToast } from "../lib/toast.jsx";
import { sendCanBusBaudRate } from "../lib/canCommands.js";
import protocol from "../../../shared/protocol.js";

const { CAN_BUS_BAUD_OPTIONS } = protocol;

const BAUD_OPTIONS = [
  { value: "9600", label: "9600" },
  { value: "19200", label: "19200" },
  { value: "115200", label: "115200 (default)" },
];

/**
 * First screen: pick device type (BMS or RBMS) and connect to a serial port.
 * Mirrors the old app's "Select Device Type" + "Get Serial Port" flow, but as
 * a dedicated full-screen step rather than fields buried in a shared tab bar.
 */
export default function ConnectionSetup({ onReady }) {
  const serial = useSerialConnection();
  const pcan = usePcanConnection();
  // "serial" (Aeidth CAN Tool) and "rs485" are the same underlying COM-port
  // transport (see serialManager.js) - the distinction only matters for the
  // RS485 keepalive poll (useRs485Keepalive, wired in App.jsx) and the label
  // shown here, mirroring the old app's separate "aeidthCanTool"/"rs485"
  // communicationCable values which otherwise behaved identically.
  const [transport, setTransport] = useState("serial"); // "serial" | "rs485" | "pcan"
  const isSerialFamily = transport === "serial" || transport === "rs485";
  const [deviceType, setDeviceType] = useState(null);
  const [selectedPort, setSelectedPort] = useState("");
  const [baudRate, setBaudRate] = useState("115200");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [pcanBaud, setPcanBaud] = useState(500);
  // Legacy app's openSerialPort() calls setBaudRate() immediately after the
  // port opens (renderer.js:1183), using whatever the CAN baud dropdown is
  // set to (defaults to 500 kbps in its HTML). Without this, the device's
  // CAN transceiver bus speed is never configured and it never replies to
  // any command, including the config fetch.
  const [canBusBaud, setCanBusBaud] = useState(3);
  const showToast = useToast();

  // Whichever transport is active drives connection status - only one can
  // ever be connected at once (main.js tears down the other on connect).
  const status = transport === "pcan" ? pcan.status : serial.status;
  const error = transport === "pcan" ? pcan.error : serial.error;
  const busy = transport === "pcan" ? pcan.busy : serial.busy;

  const handleConnect = async () => {
    if (isSerialFamily) {
      if (!selectedPort) {
        showToast("Select a COM port first", "failure");
        return;
      }
      const result = await serial.connect(selectedPort, Number(baudRate));
      if (result.success) {
        showToast(`Connected to ${selectedPort}`, "success");
        await sendCanBusBaudRate(canBusBaud);
      } else {
        showToast(result.error || "Failed to connect", "failure");
      }
    } else {
      if (!selectedChannel) {
        showToast("Select a PCAN channel first", "failure");
        return;
      }
      const result = await pcan.connect(Number(selectedChannel), pcanBaud);
      if (result.success) {
        showToast(`Connected to PCAN channel`, "success");
      } else {
        showToast(result.error || "Failed to connect to PCAN", "failure");
      }
    }
  };

  const handleCanBusBaudChange = async (index) => {
    setCanBusBaud(index);
    if (isSerialFamily && status.connected) await sendCanBusBaudRate(index);
  };

  const canEnter = deviceType && status.connected;

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 20% 20%, rgba(47,111,237,0.12), transparent 45%), radial-gradient(circle at 80% 80%, rgba(138,79,224,0.12), transparent 45%), var(--bg)",
        overflow: "auto",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 880, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>CAN Data Viewer Pro</h1>
          <p style={{ color: "var(--text-muted)", marginTop: 6 }}>
            Select a device type and connect to your CAN interface to begin.
          </p>
        </div>

        <div className="grid grid-2" style={{ gap: 18 }}>
          <ModeCard
            active={deviceType === "bms"}
            accent="bms"
            icon="&#9889;"
            title="BMS Mode"
            description="Battery Management System — live dashboard, cell/pack/temperature configuration, control center, warnings, firmware."
            onClick={() => setDeviceType("bms")}
          />
          <ModeCard
            active={deviceType === "rbms"}
            accent="rbms"
            icon="&#9881;"
            title="RBMS Mode"
            description="Rack BMS / Inverter-linked system — RBMS dashboard, BMU + inverter configuration, RBMS command center, firmware."
            onClick={() => setDeviceType("rbms")}
          />
        </div>

        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {transport === "pcan" ? "PCAN Connection" : transport === "rs485" ? "RS485 Connection" : "Serial Connection (Aeidth CAN Tool)"}
            </div>
            <div className="segmented" style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                className={`btn btn-small ${transport === "serial" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => !status.connected && setTransport("serial")}
                disabled={status.connected}
              >
                Aeidth CAN Tool
              </button>
              <button
                type="button"
                className={`btn btn-small ${transport === "rs485" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => !status.connected && setTransport("rs485")}
                disabled={status.connected}
              >
                RS485
              </button>
              <button
                type="button"
                className={`btn btn-small ${transport === "pcan" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => !status.connected && setTransport("pcan")}
                disabled={status.connected}
              >
                PCAN-USB
              </button>
            </div>
          </div>

          {isSerialFamily ? (
            <div className="grid grid-4" style={{ alignItems: "end" }}>
              <div className="field">
                <label>COM Port</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)} style={{ flex: 1 }}>
                    <option value="">Select a port…</option>
                    {serial.ports.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.friendlyName || p.path} ({p.path})
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary"
                    onClick={serial.refreshPorts}
                    title="Refresh port list"
                    type="button"
                  >
                    &#8635;
                  </button>
                </div>
                {serial.ports.length === 0 && (
                  <span className="field-hint">
                    No serial ports detected. Plug in your CAN interface, then refresh.
                  </span>
                )}
              </div>
              <div className="field">
                <label>{transport === "rs485" ? "RS485 Baud Rate" : "Serial Baud Rate"}</label>
                <select value={baudRate} onChange={(e) => setBaudRate(e.target.value)}>
                  {BAUD_OPTIONS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                {transport === "rs485" && (
                  <span className="field-hint">
                    A keepalive poll is sent every second while connected to keep the RS485 link active.
                  </span>
                )}
              </div>
              <div className="field">
                <label>CAN Bus Baud Rate</label>
                <select value={canBusBaud} onChange={(e) => handleCanBusBaudChange(Number(e.target.value))}>
                  {CAN_BUS_BAUD_OPTIONS.map((b) => (
                    <option key={b.index} value={b.index}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Sent to the device automatically on connect, matching the CAN transceiver's actual bus speed.
                </span>
              </div>
              <div>
                {status.connected ? (
                  <button className="btn btn-danger" style={{ width: "100%" }} disabled>
                    Connected to {status.path}
                  </button>
                ) : (
                  <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleConnect} disabled={busy}>
                    {busy ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-3" style={{ alignItems: "end" }}>
              <div className="field">
                <label>PCAN Channel</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={selectedChannel}
                    onChange={(e) => setSelectedChannel(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Select a channel…</option>
                    {pcan.channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary"
                    onClick={pcan.refreshChannels}
                    title="Refresh channel list"
                    type="button"
                  >
                    &#8635;
                  </button>
                </div>
                <span className="field-hint">
                  Requires the PEAK PCAN-Basic driver (PCANBasic.dll) to be installed.
                </span>
              </div>
              <div className="field">
                <label>CAN Bus Baud Rate</label>
                <select value={pcanBaud} onChange={(e) => setPcanBaud(Number(e.target.value))}>
                  {(pcan.baudRates.length ? pcan.baudRates : [{ value: 500, label: "500 kbps" }]).map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">Set directly on the PCAN channel at connect time.</span>
              </div>
              <div>
                {status.connected ? (
                  <button className="btn btn-danger" style={{ width: "100%" }} disabled>
                    Connected to {status.path}
                  </button>
                ) : (
                  <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleConnect} disabled={busy}>
                    {busy ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          )}
          {error && (
            <div style={{ marginTop: 12, color: "var(--danger)", fontSize: 12.5, fontWeight: 600 }}>{error}</div>
          )}
        </div>

        <button
          className="btn btn-primary"
          style={{ alignSelf: "center", padding: "12px 40px", fontSize: 14 }}
          disabled={!canEnter}
          onClick={() => onReady(deviceType, transport)}
        >
          {canEnter ? `Enter ${deviceType.toUpperCase()} Dashboard →` : "Select mode and connect to continue"}
        </button>
      </div>
    </div>
  );
}

function ModeCard({ active, accent, icon, title, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        textAlign: "left",
        border: active ? `2px solid var(--${accent}-accent)` : "1px solid var(--border)",
        background: active ? `var(--${accent}-accent-bg)` : "var(--bg-elevated)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "all 0.15s ease",
      }}
      type="button"
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          background: `var(--${accent}-accent)`,
          color: "white",
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: icon }} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{description}</div>
    </button>
  );
}
