import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../lib/toast.jsx";
import { sendCanLogin, sendCommand, sleep } from "../../lib/canCommands.js";
import protocol from "../../../../shared/protocol.js";

const { CAN_ID, integerTo4ByteArray } = protocol;

// Ported verbatim from index.html's RBMS custom-command dropdown.
const RBMS_COMMANDS = [
  { value: "0x41", label: "MCU Reset" },
  { value: "0x42", label: "Broadcast Enable" },
  { value: "0x43", label: "Broadcast Disable" },
  { value: "0x44", label: "Request RBMS Config" },
  { value: "0x45", label: "Request RBMS Config Update" },
  { value: "0x6D", label: "Request BMS Config CAN" },
  { value: "0x70", label: "Boot Swap" },
  { value: "0x71", label: "Request RBMS Boot Switch" },
  { value: "0x72", label: "Request Default Setting" },
  { value: "0x30", label: "Request BMS Warning Config CAN" },
];

export default function RbmsCommandCenter({ connection }) {
  const showToast = useToast();
  const [selected, setSelected] = useState("");
  const [currentCal, setCurrentCal] = useState("");
  const [batteryCapacity, setBatteryCapacity] = useState("");
  const [sending, setSending] = useState(false);

  const requireConnection = () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return false;
    }
    return true;
  };

  const sendCustomCommand = async () => {
    if (!requireConnection()) return;
    if (!selected) {
      showToast("Select a command first", "failure");
      return;
    }
    setSending(true);
    try {
      await sendCanLogin();
      await sleep(10);
      await sendCommand(CAN_ID.CMD_TX, 1, [0x41, 0x44, 0x54, 0x26, parseInt(selected, 16), 0x00, 0x00, 0x00]);
      showToast("Command sent", "success");
    } finally {
      setSending(false);
    }
  };

  const sendCurrentCalibration = async () => {
    if (!requireConnection()) return;
    const raw = parseInt(currentCal, 10);
    if (isNaN(raw) || raw < 0 || raw > 16777215) {
      showToast("Enter a valid value (0 – 16777215 mA)", "failure");
      return;
    }
    await sendCanLogin();
    await sleep(10);
    await sendCommand(CAN_ID.CMD_TX, 1, [0x41, 0x44, 0x54, 0x26, 0x7a, raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff]);
    showToast("Current Calibration sent", "success");
  };

  const sendBatteryCapacity = async () => {
    if (!requireConnection()) return;
    const ah = parseFloat(batteryCapacity);
    if (isNaN(ah) || ah < 0) {
      showToast("Enter a valid capacity in Ah", "failure");
      return;
    }
    const mAh = Math.round(ah * 1000);
    if (mAh > 16777215) {
      showToast("Value too large (max 16777.215 Ah)", "failure");
      return;
    }
    await sendCanLogin();
    await sleep(10);
    await sendCommand(CAN_ID.CMD_TX, 1, [0x41, 0x44, 0x54, 0x26, 0x6b, mAh & 0xff, (mAh >> 8) & 0xff, (mAh >> 16) & 0xff]);
    showToast("Battery Capacity sent", "success");
  };

  const fetchCellTempMask = async () => {
    if (!requireConnection()) return;
    await sendCommand(CAN_ID.CELL_TEMP_MASK_TX, 1, [1, 0, 0, 0, 0, 0, 0, 0]);
    showToast("Cell Temp Mask request sent", "success");
  };

  return (
    <div className="page-container">
      <PageHeader title="RBMS Command Center" subtitle="Custom commands, current calibration, battery capacity and cell temp mask." />

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Connect to a serial port to send commands.</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Custom Command</div>
        <div className="grid grid-3" style={{ alignItems: "end" }}>
          <div className="field">
            <label>Command</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select Command</option>
              {RBMS_COMMANDS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} ({c.value})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={sendCustomCommand} disabled={sending || !connection.status.connected}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Current Calibration</div>
          <div className="field">
            <label>Value (mA, 0 – 16777215)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" value={currentCal} onChange={(e) => setCurrentCal(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={sendCurrentCalibration}>
                Send
              </button>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Battery Capacity</div>
          <div className="field">
            <label>Capacity (Ah, max 16777.215)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" value={batteryCapacity} onChange={(e) => setBatteryCapacity(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={sendBatteryCapacity}>
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Cell Temperature Mask</div>
        <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 12 }}>
          Fetches per-BMU checkboxes indicating which cell-temperature sensors are active. Full editing UI can be extended once a real
          BMU count/topology is available from hardware.
        </p>
        <button className="btn btn-secondary" onClick={fetchCellTempMask}>
          Fetch Cell Temp Mask
        </button>
      </div>
    </div>
  );
}
