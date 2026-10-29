import React, { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../lib/toast.jsx";
import { sendCanLogin, sendCommand, sleep } from "../../lib/canCommands.js";
import protocol from "../../../../shared/protocol.js";

const { CAN_ID, integerTo4ByteArray, byteToSigned, byteArrayToUnsignedInt2, byteArrayToInt4 } = protocol;

// Warning struct fields, ported from js/warningConfig.js parseWarningData().
// 28-byte payload received in 4 frames of 7 bytes each (CAN id 216990369).
const WARNING_FIELDS = [
  { key: "cellOverVoltage", label: "Cell Over Voltage", unit: "mV", range: "0–65535", type: "u2" },
  { key: "cellUnderVoltage", label: "Cell Under Voltage", unit: "mV", range: "0–65535", type: "u2" },
  { key: "chgOverTemp", label: "Cell Charging Over Temp", unit: "°C", range: "-128–127", type: "i1" },
  { key: "chgUnderTemp", label: "Cell Charging Under Temp", unit: "°C", range: "-128–127", type: "i1" },
  { key: "dsgOverTemp", label: "Cell Discharging Over Temp", unit: "°C", range: "-128–127", type: "i1" },
  { key: "dsgUnderTemp", label: "Cell Discharging Under Temp", unit: "°C", range: "-128–127", type: "i1" },
  { key: "packOverVoltage", label: "Pack Over Voltage", unit: "mV", range: "0–4294967295", type: "u4" },
  { key: "packUnderVoltage", label: "Pack Under Voltage", unit: "mV", range: "0–4294967295", type: "u4" },
  { key: "chgOverCurrent", label: "Charging Over Current", unit: "mA", range: "0–4294967295", type: "u4" },
  { key: "dsgOverCurrent", label: "Discharging Over Current", unit: "mA", range: "0–4294967295", type: "u4" },
  { key: "socWarning", label: "SOC Warning", unit: "%", range: "0–255", type: "u1" },
  { key: "socAlarm", label: "SOC Alarm", unit: "%", range: "0–255", type: "u1" },
  { key: "sohWarning", label: "SOH Warning", unit: "%", range: "0–255", type: "u1" },
  { key: "sohAlarm", label: "SOH Alarm", unit: "%", range: "0–255", type: "u1" },
];

const WARNING_TX_CAN_ID = 0x0cef02a0;
const FETCH_TIMEOUT_MS = 3000;

function parseWarningBuffer(d) {
  return {
    cellOverVoltage: byteArrayToUnsignedInt2([d[0], d[1]]),
    cellUnderVoltage: byteArrayToUnsignedInt2([d[2], d[3]]),
    chgOverTemp: byteToSigned(d[4]),
    chgUnderTemp: byteToSigned(d[5]),
    dsgOverTemp: byteToSigned(d[6]),
    dsgUnderTemp: byteToSigned(d[7]),
    packOverVoltage: byteArrayToInt4([d[11], d[10], d[9], d[8]]) >>> 0,
    packUnderVoltage: byteArrayToInt4([d[15], d[14], d[13], d[12]]) >>> 0,
    chgOverCurrent: byteArrayToInt4([d[19], d[18], d[17], d[16]]) >>> 0,
    dsgOverCurrent: byteArrayToInt4([d[23], d[22], d[21], d[20]]) >>> 0,
    socWarning: d[24],
    socAlarm: d[25],
    sohWarning: d[26],
    sohAlarm: d[27],
  };
}

export default function BmsWarnings({ liveData, connection, embedded = false }) {
  const [fetching, setFetching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(null);
  const [editValues, setEditValues] = useState({});
  const bufferRef = useRef([]);
  const timeoutRef = useRef(null);
  const showToast = useToast();

  useEffect(() => {
    if (liveData._lastCanValue === CAN_ID.WARNING_DATA) {
      // Frame content isn't exposed directly by the shared decoder (warning
      // parsing needs the raw frame), so we listen at the IPC layer instead.
    }
  }, [liveData._lastCanValue]);

  useEffect(() => {
    const unsubscribe = window.canApi.onData((frame) => {
      const canId = [frame[7], frame[6], frame[5], frame[4]];
      const canValue = ((canId[0] << 24) | (canId[1] << 16) | (canId[2] << 8) | canId[3]) >>> 0;
      if (canValue !== CAN_ID.WARNING_DATA) return;
      const index = frame[9];
      if (index === 0) bufferRef.current = [];
      for (let i = 10; i <= 16; i++) bufferRef.current.push(frame[i]);
      if (bufferRef.current.length === 28) {
        setValues(parseWarningBuffer(bufferRef.current));
        setFetching(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        showToast("Warning data fetched successfully", "success");
      }
    });
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetch = async () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return;
    }
    bufferRef.current = [];
    setFetching(true);
    showToast("Fetching warning data…", "info");
    await sendCanLogin();
    await sleep(10);
    await sendCommand(CAN_ID.CMD_TX, 1, [0x41, 0x44, 0x54, 0x26, 0x30, 0x00, 0x00, 0x00]);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setFetching((f) => {
        if (f) showToast("Warning fetch failed. Check connection.", "failure");
        return false;
      });
    }, FETCH_TIMEOUT_MS);
  };

  const beginEdit = () => {
    setEditValues({ ...values });
    setEditing(true);
  };

  const handleSend = async () => {
    const to2 = (v) => [v & 0xff, (v >> 8) & 0xff];
    const to4 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
    const v = editValues;
    const bytes = [
      ...to2(Number(v.cellOverVoltage) || 0),
      ...to2(Number(v.cellUnderVoltage) || 0),
      Number(v.chgOverTemp) & 0xff,
      Number(v.chgUnderTemp) & 0xff,
      Number(v.dsgOverTemp) & 0xff,
      Number(v.dsgUnderTemp) & 0xff,
      ...to4(Number(v.packOverVoltage) || 0),
      ...to4(Number(v.packUnderVoltage) || 0),
      ...to4(Number(v.chgOverCurrent) || 0),
      ...to4(Number(v.dsgOverCurrent) || 0),
      Number(v.socWarning) & 0xff,
      Number(v.socAlarm) & 0xff,
      Number(v.sohWarning) & 0xff,
      Number(v.sohAlarm) & 0xff,
    ];
    const canId = integerTo4ByteArray(WARNING_TX_CAN_ID);
    for (let i = 0; i < 4; i++) {
      const chunk = bytes.slice(i * 7, (i + 1) * 7);
      await sendCommand(WARNING_TX_CAN_ID, 1, [i, ...chunk]);
      await sleep(10);
    }
    showToast("Warning config sent", "success");
    setEditing(false);
    setValues(editValues);
  };

  const display = editing ? editValues : values;

  const actions = (
    <div style={{ display: "flex", gap: 8 }}>
      <button className="btn btn-primary" onClick={handleFetch} disabled={fetching || !connection.status.connected}>
        {fetching ? "Fetching…" : "Fetch"}
      </button>
      {values && !editing && (
        <button className="btn btn-secondary" onClick={beginEdit}>
          Edit
        </button>
      )}
      {editing && (
        <>
          <button className="btn btn-primary" onClick={handleSend}>
            Send to Device
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className={embedded ? undefined : "page-container"} style={embedded ? { display: "flex", flexDirection: "column", gap: 16 } : undefined}>
      {embedded ? (
        actions
      ) : (
        <PageHeader
          title="Warning Settings"
          subtitle="Cell/pack voltage, temperature, current, SOC and SOH warning &amp; alarm thresholds."
          right={actions}
        />
      )}

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Connect to a serial port to fetch warning settings.</div>
        </div>
      )}

      <div className="card">
        {!display ? (
          <div className="empty-state">
            <span className="empty-icon">⚠</span>
            <span>No warning data loaded yet. Click "Fetch" once connected.</span>
          </div>
        ) : (
          <div className="grid grid-4">
            {WARNING_FIELDS.map((f) => (
              <div className="config-field" key={f.key}>
                <label>{f.label}</label>
                {editing ? (
                  <input
                    type="number"
                    value={editValues[f.key] ?? 0}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                ) : (
                  <span className="config-value">
                    {display[f.key]} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{f.unit}</span>
                  </span>
                )}
                <span className="config-range">Range: {f.range}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
