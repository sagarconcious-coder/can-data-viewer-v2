import React, { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../lib/toast.jsx";
import { sendCommand, sleep } from "../../lib/canCommands.js";
import protocol from "../../../../shared/protocol.js";

const { CAN_ID } = protocol;

// Model ID builder options, ported from the legacy BMU tab (index.html mmid-* selects).
const YEARS = ["25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35"];
const CELL_OPTIONS = [
  ["A", "12S"], ["B", "24S"], ["C", "32S"], ["D", "7S"], ["E", "8S"], ["F", "10S"], ["G", "13S"], ["H", "16S"],
  ["I", "15S"], ["J", "14S"], ["K", "17S"], ["L", "18S"], ["M", "19S"], ["N", "20S"], ["O", "21S"], ["P", "22S"], ["Q", "23S"],
];
const TEMP_OPTIONS = [["A", "10"], ["B", "8"], ["C", "4"], ["D", "2"]];
const FAN_OPTIONS = [["A", "12V"], ["B", "24V"], ["C", "48V"]];

const lookup = (options, code) => options.find(([c]) => c === code)?.[1];

// Model ID layout is "BMU" + year(2) + cells + temp + fan, so No. of S / Temp
// can be read back from a fetched model ID (the BMU has no separate reply for them).
function decodeModelId(modelId) {
  const m = /^BMU\d{2}([A-Z])([A-Z])([A-Z])$/.exec(modelId || "");
  if (!m) return { cells: null, temp: null };
  return { cells: lookup(CELL_OPTIONS, m[1]) ?? null, temp: lookup(TEMP_OPTIONS, m[2]) ?? null };
}

function frameCanId(frame) {
  return ((frame[7] << 24) | (frame[6] << 16) | (frame[5] << 8) | frame[4]) >>> 0;
}

const FETCH_TIMEOUT_MS = 3000;

const ascii = (bytes) => String.fromCharCode(...bytes).replace(/\0/g, "");

/** BMU identity: fetch/set cell & temp count, model ID and UUID (ported from js/bmuConfig.js). */
export default function BmuIdentityConfig({ connection, dataStatus }) {
  const showToast = useToast();
  const [modelId, setModelId] = useState("");
  const [uuid, setUuid] = useState("");
  const [noOfCells, setNoOfCells] = useState("");
  const [noOfTemp, setNoOfTemp] = useState("");
  const [mmid, setMmid] = useState({ year: "", cells: "", temp: "", fan: "" });
  const [uuidInput, setUuidInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const timeoutRef = useRef(null);

  const { year, cells, temp, fan } = mmid;
  const generatedModelId = year && cells && temp && fan ? `BMU${year}${cells}${temp}${fan}` : "";

  // No CRC check on replies: PCAN frames arrive with zeroed CRC bytes (see
  // pcanManager.js), so the legacy isCrcValid() would drop every one of them.
  useEffect(() => {
    let uuidBuffer = "";
    return window.canApi.onData((frame) => {
      const canValue = frameCanId(frame);
      if (canValue === CAN_ID.BMU_MODEL_ID_RX) {
        setModelId(ascii(frame.slice(9, 17)).trim());
      } else if (canValue === CAN_ID.BMU_UUID_RX) {
        const index = frame[9];
        if (index === 0) uuidBuffer = "";
        uuidBuffer += ascii(frame.slice(10, 17));
        setUuid(uuidBuffer);
        if (index === 1) {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setFetching(false);
          showToast("BMU data fetched successfully", "success");
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const requireConnection = () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return false;
    }
    return true;
  };

  const handleFetch = async () => {
    if (!requireConnection()) return;
    setModelId("");
    setUuid("");
    setFetching(true);
    await sendCommand(CAN_ID.BMU_CTRL_NORMAL, 1, [0, 0, 0, 0, 0, 0, 0, 0]);
    await sleep(3);
    await sendCommand(CAN_ID.BMU_CTRL_REQUEST, 1, [1, 0x17, 0, 0, 0, 0, 0, 0]);
    await sleep(3);
    await sendCommand(CAN_ID.BMU_CTRL_REQUEST, 1, [1, 0x18, 0, 0, 0, 0, 0, 0]);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setFetching((wasFetching) => {
        if (wasFetching) showToast("No response from BMU. Check the BMU is connected on the CAN bus.", "failure");
        return false;
      });
    }, FETCH_TIMEOUT_MS);
  };

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const handleSendCount = async () => {
    if (!requireConnection()) return;
    const c = parseInt(noOfCells, 10);
    const t = parseInt(noOfTemp, 10);
    if (isNaN(c) || isNaN(t)) {
      showToast("Invalid cell or temp value", "failure");
      return;
    }
    await sendCommand(CAN_ID.BMU_CTRL_COUNT, 1, [c & 0xff, t & 0xff, 0, 0, 0, 0, 0, 0]);
    showToast("Cell & Temp count sent", "success");
  };

  const handleSendModelId = async () => {
    if (!requireConnection()) return;
    if (!generatedModelId) {
      showToast("Select Year, No of S, No of Temp and FAN Voltage", "failure");
      return;
    }
    const bytes = Array.from({ length: 8 }, (_, i) => (i < generatedModelId.length ? generatedModelId.charCodeAt(i) : 0));
    await sendCommand(CAN_ID.BMU_CTRL_MMID, 1, bytes);
    showToast("Model ID sent", "success");
  };

  const handleSendUuid = async () => {
    if (!requireConnection()) return;
    const value = uuidInput.trim();
    if (!value || value.length > 14) {
      showToast("UUID must be 1–14 characters", "failure");
      return;
    }
    for (let i = 0; i < 2; i++) {
      const chunk = value.slice(i * 7, (i + 1) * 7);
      const bytes = Array.from({ length: 7 }, (_, j) => (j < chunk.length ? chunk.charCodeAt(j) : 0));
      await sendCommand(CAN_ID.BMU_CTRL_UUID, 1, [i, ...bytes]);
      await sleep(3);
    }
    showToast("UUID sent", "success");
  };

  const setMmidPart = (key) => (e) => {
    const next = { ...mmid, [key]: e.target.value };
    setMmid(next);
    // Legacy builder also pre-fills the UUID field with the generated model ID.
    const built = next.year && next.cells && next.temp && next.fan ? `BMU${next.year}${next.cells}${next.temp}${next.fan}` : "";
    setUuidInput(built);
  };

  const decoded = decodeModelId(modelId);

  return (
    <div className="page-container">
      <PageHeader
        title="BMU Identity Configuration"
        subtitle="BMU cell/temp count, model ID and UUID."
        dataStatus={dataStatus}
        right={
          <button className="btn btn-primary" onClick={handleFetch} disabled={fetching || !connection.status.connected}>
            {fetching ? "Fetching…" : "Fetch Data"}
          </button>
        }
      />

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Connect to a serial port before fetching or sending BMU data.</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">BMU Configuration</div>
        <div className="grid grid-4">
          <Tile label="No. of S" value={decoded.cells} />
          <Tile label="No. of Temp" value={decoded.temp} />
          <Tile label="Model ID" value={modelId} />
          <Tile label="UUID" value={uuid} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Cell &amp; Temp Count</div>
        <div className="grid grid-2">
          <div className="field">
            <label>No of Cell</label>
            <input type="number" min="0" value={noOfCells} onChange={(e) => setNoOfCells(e.target.value)} />
          </div>
          <div className="field">
            <label>No of Temp</label>
            <input type="number" min="0" value={noOfTemp} onChange={(e) => setNoOfTemp(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={handleSendCount}>
            Send Count
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Model ID Builder</div>
          <div className="grid grid-4">
            <SelectField label="Year" value={year} onChange={setMmidPart("year")} options={YEARS.map((y) => [y, y])} />
            <SelectField label="No of S" value={cells} onChange={setMmidPart("cells")} options={CELL_OPTIONS} />
            <SelectField label="No of Temp" value={temp} onChange={setMmidPart("temp")} options={TEMP_OPTIONS} />
            <SelectField label="FAN Voltage" value={fan} onChange={setMmidPart("fan")} options={FAN_OPTIONS} />
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Generated Model ID</label>
            <input readOnly value={generatedModelId} placeholder="—" />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={handleSendModelId} disabled={!generatedModelId}>
              Send Model ID
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">UUID</div>
          <div className="field">
            <label>UUID (max 14 chars)</label>
            <input value={uuidInput} maxLength={14} onChange={(e) => setUuidInput(e.target.value)} />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={handleSendUuid}>
              Send UUID
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ wordBreak: "break-all" }}>{value || "-"}</span>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={onChange}>
        <option value="">Select</option>
        {options.map(([code, text]) => (
          <option key={code} value={code}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
