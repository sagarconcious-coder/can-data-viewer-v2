import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../lib/toast.jsx";
import { sendCustomAdtCommand } from "../../lib/canCommands.js";

// Ported verbatim from index.html's BMS Control Center command dropdown.
const COMMANDS = [
  { value: "0x41", label: "BMS Reset" },
  { value: "0x42", label: "Fuel Gauge Reset" },
  { value: "0x43", label: "AFE Reset" },
  { value: "0x44", label: "Send BMS to Sleep Mode" },
  { value: "0x45", label: "Send BMS to Wake Up Mode" },
  { value: "0x46", label: "I2C Enable" },
  { value: "0x47", label: "I2C Disable" },
  { value: "0x48", label: "SPI Enable" },
  { value: "0x49", label: "SPI Disable" },
  { value: "0x4B", label: "UART Enable" },
  { value: "0x4C", label: "UART Disable" },
  { value: "0x4D", label: "LED Disable" },
  { value: "0x4F", label: "LED Enable" },
  { value: "0x50", label: "CAN Enable" },
  { value: "0x51", label: "CAN Disable" },
  { value: "0x52", label: "BAL Enable" },
  { value: "0x53", label: "BAL Disable" },
  { value: "0x54", label: "BAL OV Enable" },
  { value: "0x55", label: "BAL OV Disable" },
  { value: "0x56", label: "Memory Erase 1" },
  { value: "0x57", label: "Memory Erase 2" },
  { value: "0x58", label: "Read Memory 1" },
  { value: "0x68", label: "BMS Calibration" },
  { value: "0x69", label: "BMS Calibration Zero" },
  { value: "0x72", label: "Factory Reset" },
  { value: "0x73", label: "Disable Charger Authentication" },
];

export default function BmsControlCenter({ connection }) {
  const [selected, setSelected] = useState("");
  const [sending, setSending] = useState(false);
  const [currentCal, setCurrentCal] = useState("");
  const [batteryCapacity, setBatteryCapacity] = useState("");
  const showToast = useToast();

  const send = async () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return;
    }
    if (!selected) {
      showToast("Select a command first", "failure");
      return;
    }
    setSending(true);
    try {
      await sendCustomAdtCommand(parseInt(selected, 16));
      showToast(`Command ${selected} sent`, "success");
    } finally {
      setSending(false);
    }
  };

  const sendCurrentCalibration = async () => {
    const raw = parseInt(currentCal, 10);
    if (isNaN(raw) || raw < 0 || raw > 16777215) {
      showToast("Enter a valid value (0 – 16777215 mA)", "failure");
      return;
    }
    await sendCustomAdtCommand(0x7a, [raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff]);
    showToast("Current Calibration sent", "success");
  };

  const sendBatteryCapacity = async () => {
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
    await sendCustomAdtCommand(0x6b, [mAh & 0xff, (mAh >> 8) & 0xff, (mAh >> 16) & 0xff]);
    showToast("Battery Capacity sent", "success");
  };

  return (
    <div className="page-container">
      <PageHeader title="BMS Control Center" subtitle="Send single-byte control commands directly to the BMS over CAN." />

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Connect to a serial port to send commands.</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Send Command</div>
        <div className="grid grid-3" style={{ alignItems: "end" }}>
          <div className="field">
            <label>Command</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select a command…</option>
              {COMMANDS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} ({c.value})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={send} disabled={sending || !connection.status.connected}>
            {sending ? "Sending…" : "Send Command"}
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
              <button className="btn btn-secondary" onClick={sendCurrentCalibration} disabled={!connection.status.connected}>
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
              <input
                type="number"
                value={batteryCapacity}
                onChange={(e) => setBatteryCapacity(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn btn-secondary" onClick={sendBatteryCapacity} disabled={!connection.status.connected}>
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
