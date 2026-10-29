import React, { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../lib/toast.jsx";
import { sendFetchConfiguration, sendCommand, sleep } from "../../lib/canCommands.js";
import protocol from "../../../../shared/protocol.js";

const { CONFIG_FIELDS, CONFIG_TABS, encodeConfigArray, decodeConfigArray, CAN_ID } = protocol;

const TABS = [
  { key: "cell", label: "Cell Settings" },
  { key: "pack", label: "Pack Settings" },
  { key: "temperature", label: "Temperature Settings" },
  { key: "pdu", label: "PDU Card Settings" },
  { key: "other", label: "Other Settings" },
];

const FIELD_BY_KEY = Object.fromEntries(CONFIG_FIELDS.map((f) => [f.key, f]));
const FETCH_TIMEOUT_MS = 4000;
// Legacy sendConfig() always writes 23 frames of [index, 7 bytes] = 161 bytes.
const CONFIG_BYTES = 161;
const CHUNK = 7;

/**
 * 161-byte configuration struct editor (ported from newConfig.js). Used as the
 * BMS Configuration page and, with `embedded`, inside RBMS Protection Parameters.
 */
export default function BmsConfiguration({ liveData, connection, resetConfigBuffer, deviceType = "bms", embedded = false }) {
  const [activeTab, setActiveTab] = useState("cell");
  const [fetching, setFetching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [fileValues, setFileValues] = useState(null);
  const timeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const showToast = useToast();

  const deviceLabel = deviceType === "bms" ? "BMS" : "RBMS";
  const { configFetchComplete } = liveData;
  const configValues = fileValues ?? liveData.configValues;

  useEffect(() => {
    if (configFetchComplete && fetching) {
      setFetching(false);
      window.__CONFIG_FETCH_ACTIVE__ = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      showToast(`${deviceLabel} configuration fetched successfully`, "success");
    }
  }, [configFetchComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetch = async () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return;
    }
    resetConfigBuffer();
    setFileValues(null);
    setFetching(true);
    setEditing(false);
    window.__CONFIG_FETCH_ACTIVE__ = true;
    showToast(`Fetching ${deviceLabel} configuration…`, "info");
    await sendFetchConfiguration(deviceType);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setFetching((wasFetching) => {
        if (wasFetching) showToast("Configuration fetch failed. Check serial wire/connection.", "failure");
        return false;
      });
      window.__CONFIG_FETCH_ACTIVE__ = false;
    }, FETCH_TIMEOUT_MS);
  };

  const beginEdit = () => {
    setEditValues({ ...configValues });
    setEditing(true);
  };

  const toConfigBytes = (vals) => {
    const bytes = encodeConfigArray(vals, deviceType);
    while (bytes.length < CONFIG_BYTES) bytes.push(0);
    return bytes;
  };

  const handleSave = async () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return;
    }
    const encoded = toConfigBytes(editValues);
    for (let i = 0; i < CONFIG_BYTES; i += CHUNK) {
      await sendCommand(CAN_ID.CONFIG_TX, 1, [i / CHUNK, ...encoded.slice(i, i + CHUNK)]);
      await sleep(10);
    }
    showToast("Configuration written to device", "success");
    setEditing(false);
  };

  // Same file format as the legacy app: comma-separated config bytes.
  const handleDownload = () => {
    const blob = new Blob([toConfigBytes(configValues).join(",")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${liveData.bmsModelId || deviceType}config.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChosen = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = String(reader.result)
        .split(",")
        .map((s) => parseInt(s.trim(), 10));
      if (bytes.length < CONFIG_BYTES - 1 || bytes.some((b) => Number.isNaN(b))) {
        showToast("Invalid configuration file", "failure");
        return;
      }
      setFileValues(decodeConfigArray(bytes, deviceType));
      setEditing(false);
      showToast(`Loaded ${file.name}`, "success");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const values = editing ? editValues : configValues;

  const actions = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn btn-primary" onClick={handleFetch} disabled={fetching || !connection.status.connected}>
        {fetching ? "Fetching…" : "Fetch Configuration"}
      </button>
      {configValues && !editing && (
        <button className="btn btn-secondary" onClick={beginEdit}>
          Edit
        </button>
      )}
      {editing && (
        <>
          <button className="btn btn-primary" onClick={handleSave}>
            Save to Device
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      )}
      <button className="btn btn-secondary" onClick={handleDownload} disabled={!configValues || editing}>
        Download
      </button>
      <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={editing}>
        Load File
      </button>
      <input ref={fileInputRef} type="file" accept=".txt" style={{ display: "none" }} onChange={handleFileChosen} />
    </div>
  );

  return (
    <div className={embedded ? undefined : "page-container"} style={embedded ? { display: "flex", flexDirection: "column", gap: 16 } : undefined}>
      {embedded ? (
        actions
      ) : (
        <PageHeader
          title={`${deviceLabel} Configuration`}
          subtitle="161-byte configuration struct — cell, pack, temperature, PDU and other thresholds."
          right={actions}
        />
      )}

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Connect to a serial port before fetching configuration.</div>
        </div>
      )}

      {fetching && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Spinner />
            <span>Waiting for configuration data from device (times out after {FETCH_TIMEOUT_MS / 1000}s)…</span>
          </div>
        </div>
      )}

      {fileValues && !fetching && (
        <div className="card">
          <span style={{ color: "var(--text-muted)" }}>Showing values loaded from file. Edit → Save to Device to write them.</span>
        </div>
      )}

      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t.key} className={activeTab === t.key ? "active" : ""} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        {!values ? (
          <div className="empty-state">
            <span className="empty-icon">⚙</span>
            <span>No configuration loaded yet. Click "Fetch Configuration" once connected, or load a saved file.</span>
          </div>
        ) : (
          <div className="grid grid-4">
            {CONFIG_TABS[activeTab].map((key) => {
              const field = FIELD_BY_KEY[key];
              if (!field) return null;
              return (
                <div className={`config-field${editing ? " editing" : ""}`} key={key}>
                  <label>{field.label}</label>
                  {editing ? (
                    <input
                      type="number"
                      value={editValues[key] ?? 0}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  ) : (
                    <span className="config-value">
                      {values[key]} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{field.unit}</span>
                    </span>
                  )}
                  {field.range && <span className="config-range">Range: {field.range}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        border: "2px solid var(--border)",
        borderTopColor: "var(--bms-accent)",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }}
    >
      <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
