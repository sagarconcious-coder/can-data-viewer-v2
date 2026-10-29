import React, { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import { decodeSignals, encodeSignals } from "../lib/dbcParser.js";
import { sendCommand } from "../lib/canCommands.js";
import { useToast } from "../lib/toast.jsx";

/**
 * Live per-ID CAN grid + Transmit panel.
 *
 * Unlike Raw Monitor (an append-only log of every frame, for after-the-fact
 * inspection/filtering), this page keeps exactly one row per CAN id: the
 * first time an id shows up it appears as a new row, and every later frame
 * for that same id updates that row's bytes/signals in place - see
 * useLiveCanGrid.js. Works with either transport for the same reason Raw
 * Monitor does (see its header comment).
 *
 * The Transmit panel below it lets you send a frame. With a DBC loaded, pick
 * a message from the dropdown (built from every BO_ in the file) - the ID is
 * fixed by that selection, and you type the 8 data bytes directly (same
 * single hex-byte-string field as Raw mode), with a live read-only preview
 * of what those bytes decode to under the message's signals so you can see
 * what you're about to send in DBC terms without needing a field per signal.
 * Without a DBC (or for anything not in it), the same raw ID + 8 hex byte
 * form is used directly.
 *
 * Clicking a row selects it (BUSMASTER's "Message Interpretation" window) -
 * a panel on the right shows that message's name/id and every decoded
 * signal's physical value, raw value, and unit as a table, live: since
 * selection is tracked by CAN id rather than a snapshot of the row, the
 * panel keeps re-rendering with fresh values as more frames for that same id
 * arrive, exactly like the grid row it's pinned to.
 *
 * `liveGrid`, `dbcState` and `txFrameList` are owned by Shell (App.jsx), not
 * this component - it stays mounted across route/tab changes, so the live
 * grid, the loaded DBC, and the Tx Frame List (including any periodic
 * timers or an in-flight Play Sequence) keep running/persisting in the
 * background instead of being reset every time this page unmounts.
 *
 * The Tx Frame List (BUSMASTER's Transmit Message window) below the single-
 * frame Transmit form lets you build up multiple saved frames: "+ Add to
 * List" saves whatever's currently configured in the form above (DBC or Raw
 * mode) as a new row, each row can be sent once, toggled into periodic
 * auto-send at its own interval, or removed; "Play Sequence" walks every row
 * top to bottom, one send at a time - see useTxFrameList.js.
 */
export default function LiveMonitor({ connection, dataStatus, liveGrid, dbcState, txFrameList, frameLogging }) {
  const { rows, paused, setPaused, clear } = liveGrid;
  const { dbc, error: dbcError, loadDbcFile, clearDbc } = dbcState;
  const [selectedId, setSelectedId] = useState(null);
  const fileInputRef = useRef(null);
  const showToast = useToast();

  const decoratedRows = useMemo(() => {
    return rows.map((row) => {
      // Name only ever comes from a loaded DBC recognizing this id - never
      // from this app's own built-in protocol.CAN_ID table, so an unnamed
      // frame genuinely means "not in the DBC" rather than something that
      // looks resolved but has nothing to do with what was uploaded.
      const dbcMessage = dbc?.messages.get(row.id) ?? null;
      const name = dbcMessage?.name ?? null;
      const signals = dbcMessage ? decodeSignals(dbcMessage, row.data) : null;
      return { ...row, name, dbcMessage, signals };
    });
  }, [rows, dbc]);

  const selectedRow = selectedId !== null ? decoratedRows.find((r) => r.id === selectedId) ?? null : null;

  const handleDbcFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const result = await loadDbcFile(file);
    if (result.success) {
      showToast(`Loaded ${file.name} — ${result.messageCount} messages`, "success");
    } else {
      showToast(`Failed to parse ${file.name}: ${result.error}`, "failure");
    }
  };

  return (
    <div className="page-container page-container-wide">
      <PageHeader
        title="Live CAN Grid"
        subtitle={
          connection.status.connected
            ? `One row per CAN id on ${connection.status.path} @ ${connection.status.baudRate} — updates in place as new data arrives`
            : "Not connected — connect a tool from the sidebar to see live values"
        }
        dataStatus={dataStatus}
      />

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: dbc ? "var(--accent, var(--bms-accent))" : "var(--bg-sunken)",
              border: dbc ? "none" : "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            📄
          </div>
          <div style={{ minWidth: 0 }}>
            {dbc ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {dbc.fileName}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{dbc.messages.size} messages available to decode &amp; transmit</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 13 }}>No DBC loaded</div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Transmit will use raw ID + bytes; grid falls back to this app's built-in CAN ID table
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <input ref={fileInputRef} type="file" accept=".dbc" onChange={handleDbcFile} style={{ display: "none" }} />
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            ⬆ Upload DBC
          </button>
          {dbc && (
            <button className="btn btn-ghost" onClick={clearDbc} title="Stop using this DBC">
              ✕ Remove
            </button>
          )}
        </div>
      </div>
      {dbcError && (
        <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
          ⚠ {dbcError}
        </div>
      )}

      <div className="live-monitor-split">
        <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
          <LiveGridCard
            rows={decoratedRows}
            paused={paused}
            setPaused={setPaused}
            clear={clear}
            selectedId={selectedId}
            onSelect={setSelectedId}
            frameLogging={frameLogging}
          />
          <TransmitPanel dbc={dbc} connected={connection.status.connected} showToast={showToast} txFrameList={txFrameList} />
          <TxFrameListCard txFrameList={txFrameList} connected={connection.status.connected} showToast={showToast} />
        </div>
        <MessageInterpretationPanel row={selectedRow} />
      </div>
    </div>
  );
}

function LiveGridCard({ rows, paused, setPaused, clear, selectedId, onSelect, frameLogging }) {
  const {
    logging,
    filePath,
    format,
    pendingReuseChoice,
    pendingFormatChoice,
    startLogging,
    chooseFormat,
    cancelFormatChoice,
    resumeWithSameFile,
    resumeWithNewFile,
    cancelReuseChoice,
    stopLogging,
  } = frameLogging;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>
          Live Values ({rows.length} id{rows.length === 1 ? "" : "s"})
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {logging && (
            <span className="badge badge-danger" style={{ fontSize: 10.5 }} title={filePath}>
              ● Logging
            </span>
          )}
          <button
            className={`btn ${logging ? "btn-danger" : "btn-secondary"}`}
            onClick={logging ? stopLogging : startLogging}
            style={{ fontSize: 12, padding: "6px 12px" }}
            title={logging ? "Stop writing raw frames to the log file" : "Save every raw RX/TX frame (timestamp + message) to a file"}
          >
            {logging ? "⏹ Stop Logging" : "● Start Logging"}
          </button>
          <button
            className={`btn ${paused ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setPaused((p) => !p)}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button className="btn btn-secondary" onClick={clear} style={{ fontSize: 12, padding: "6px 12px" }}>
            🗑 Clear
          </button>
        </div>
      </div>

      {logging && filePath && (
        <div style={{ padding: "8px 18px", fontSize: 11.5, color: "var(--text-faint)", borderBottom: "1px solid var(--border)" }} className="mono">
          Logging ({format?.toUpperCase()}) to {filePath}
        </div>
      )}

      {pendingFormatChoice && (
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-sunken)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12.5 }}>Save the log as:</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => chooseFormat("csv")}>
              CSV (.csv)
            </button>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => chooseFormat("txt")}>
              Text (.aeidth.log)
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={cancelFormatChoice}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pendingReuseChoice && (
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-sunken)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12.5 }}>
            A log file was already chosen: <span className="mono">{filePath}</span> ({format?.toUpperCase()}). Save to the same file, or pick a
            new location/format?
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={resumeWithSameFile}>
              Same File
            </button>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={resumeWithNewFile}>
              Choose New Location
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={cancelReuseChoice}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ overflow: "auto", maxHeight: "50vh" }}>
        <table className="raw-monitor-table">
          <thead>
            <tr>
              <th style={{ width: 92 }}>Timestamp</th>
              <th style={{ width: 48 }}>Dir</th>
              <th style={{ width: 108 }}>CAN ID</th>
              <th style={{ width: 78 }}>Type</th>
              <th>Message</th>
              <th style={{ width: 40 }}>DLC</th>
              <th style={{ width: 190 }}>Data Bytes</th>
              <th style={{ width: 60 }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty-state" style={{ padding: 40 }}>
                    <span className="empty-icon">📶</span>
                    <span>No frames captured yet — waiting for traffic from the connected tool.</span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <FlashRow key={row.id} row={row} isSelected={selectedId === row.id} onSelect={() => onSelect(row.id)} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Row that briefly flashes when `row.flashKey` changes (an in-place update
 * arrived), and stays highlighted while selected - clicking it opens/updates
 * the Message Interpretation panel on the right. Selection is by CAN id, not
 * a copy of the row, so the flash and the panel both keep tracking the same
 * id's freshest data live.
 */
function FlashRow({ row, isSelected, onSelect }) {
  const [flashing, setFlashing] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), 350);
    return () => clearTimeout(timer);
  }, [row.flashKey]);

  return (
    <tr
      onClick={onSelect}
      style={{
        cursor: "pointer",
        background: isSelected
          ? "var(--accent-bg, var(--bms-accent-bg))"
          : flashing
            ? "var(--bg-sunken)"
            : undefined,
        boxShadow: isSelected ? "inset 3px 0 0 var(--accent, var(--bms-accent))" : undefined,
        transition: "background 0.3s ease",
      }}
      title="Click to view Message Interpretation"
    >
      <td className="mono">{formatTime(row.time)}</td>
      <td>
        <span className={`badge ${row.direction === "Tx" ? "badge-warning" : "badge-success"}`} style={{ padding: "2px 8px" }}>
          {row.direction}
        </span>
      </td>
      <td className="mono">{row.idHex}</td>
      <td>
        <span
          className="badge badge-neutral"
          style={{ padding: "2px 7px", fontSize: 10.5 }}
          title={row.idType === "Extended" ? "29-bit extended identifier" : "11-bit standard identifier"}
        >
          {row.idType}
        </span>
      </td>
      <td>
        {row.name || <span style={{ color: "var(--text-faint)" }}>—</span>}
        {row.dbcMessage && (
          <span className="badge badge-neutral" style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10, verticalAlign: "middle" }}>
            DBC
          </span>
        )}
      </td>
      <td className="mono">{row.dlc}</td>
      <td className="mono">{row.data.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</td>
      <td className="mono">{row.updateCount}</td>
    </tr>
  );
}

/**
 * BUSMASTER-style "Message Interpretation" side panel: shows the selected
 * row's name/id, then every decoded DBC signal as Name / Physical Value /
 * Raw Value / Units, re-rendering live as the selected id updates (the panel
 * receives the same decorated row object the grid does, already refreshed on
 * every frame). Falls back to raw hex bytes when no DBC signals are
 * available for the id (no DBC loaded, or the id isn't in it).
 */
function MessageInterpretationPanel({ row }) {
  return (
    <div className="card message-interpretation-panel">
      <div className="card-title">Message Interpretation</div>
      {!row ? (
        <div className="empty-state" style={{ padding: "30px 10px" }}>
          <span className="empty-icon">🔎</span>
          <span>Click a row in Live Values to inspect it here.</span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <LabeledValue label="Name" value={row.name || "—"} />
            <LabeledValue label="ID" value={`${row.id} (${row.idHex})`} mono />
            <LabeledValue label="Type" value={row.idType} />
          </div>

          {row.signals && row.signals.length > 0 ? (
            <div style={{ overflow: "auto" }}>
              <table className="raw-monitor-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th style={{ width: 90 }}>Physical</th>
                    <th style={{ width: 90 }}>Raw</th>
                    <th style={{ width: 60 }}>Units</th>
                  </tr>
                </thead>
                <tbody>
                  {row.signals.map((sig) => (
                    <tr key={sig.name}>
                      <td>{sig.name}</td>
                      <td className="mono">{sig.value === null ? "—" : formatSignalValue(sig.value)}</td>
                      <td className="mono">{sig.rawValue === null ? "—" : `0x${sig.rawValue.toString(16).toUpperCase()}`}</td>
                      <td>{sig.unit || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
              {row.dbcMessage
                ? "This message has no signals defined in the DBC."
                : "No DBC signals available for this id — upload a DBC to decode it."}
              <div className="mono" style={{ marginTop: 10, fontSize: 13 }}>
                {row.data.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LabeledValue({ label, value, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 10 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className={mono ? "mono" : undefined} style={{ fontWeight: 700, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function TransmitPanel({ dbc, connected, showToast, txFrameList }) {
  const dbcMessages = useMemo(() => (dbc ? [...dbc.messages.values()].sort((a, b) => a.name.localeCompare(b.name)) : []), [dbc]);

  const [mode, setMode] = useState("raw"); // "dbc" | "raw"
  const [selectedId, setSelectedId] = useState("");
  const [dbcBytes, setDbcBytes] = useState("00 00 00 00 00 00 00 00");
  const [dbcIdType, setDbcIdType] = useState(1); // 0 = standard, 1 = extended
  const [rawId, setRawId] = useState("");
  const [rawBytes, setRawBytes] = useState("00 00 00 00 00 00 00 00");
  const [rawIdType, setRawIdType] = useState(1); // 0 = standard, 1 = extended
  const [sending, setSending] = useState(false);

  const selectedMessage = dbc && selectedId !== "" ? dbc.messages.get(Number(selectedId)) : null;

  // Reset the byte field and re-guess the id type whenever a different DBC
  // message is picked, so a stale value/type from a previous selection can't
  // leak into an unrelated message's send. A DBC BO_ id doesn't state
  // standard-vs-extended beyond the 0x80000000 flag dbcParser.js already
  // masks off to get the id normalizeDbcId() returns, so the same >0x7FF
  // magnitude inference used for RX rows is the best default here - the
  // selector still lets the user override it either way.
  useEffect(() => {
    if (!selectedMessage) return;
    setDbcBytes("00 00 00 00 00 00 00 00");
    setDbcIdType(selectedMessage.id > 0x7ff ? 1 : 0);
  }, [selectedMessage]);

  // Live preview of what the typed bytes decode to under the selected
  // message's signal layout - editable both ways: type the 8 bytes directly
  // (same as Raw mode) and the table below updates to match, or edit a
  // signal's Physical value directly and the byte field updates to match via
  // encodeSignals() (the exact inverse of this decode) - see
  // handleSignalValueChange below. Either editing path ends up at the same
  // source of truth (dbcBytes), so Send always transmits exactly what's
  // shown here.
  const dbcPreviewBytes = selectedMessage ? parseByteString(dbcBytes) : null;
  const dbcPreviewSignals =
    selectedMessage && dbcPreviewBytes && selectedMessage.signals.length > 0
      ? decodeSignals(selectedMessage, dbcPreviewBytes).map((sig) => ({
          ...sig,
          // Round off float noise from factor/offset math (e.g. 52.3 round-tripped
          // through encode->decode can come back as 52.300000000000004) before it
          // ever reaches a controlled <input>, or every edit would append garbage
          // trailing digits to what the user just typed on the very next render.
          value: sig.value === null ? null : Math.round(sig.value * 1e6) / 1e6,
        }))
      : null;

  const handleSignalValueChange = (signalName, rawInputValue) => {
    if (!selectedMessage || !dbcPreviewSignals) return;
    // Start from what's currently decoded (so every other signal's value is
    // preserved untouched) and overlay just the one field being edited.
    const valuesByName = {};
    for (const sig of dbcPreviewSignals) valuesByName[sig.name] = sig.value;
    valuesByName[signalName] = rawInputValue;
    const bytes = encodeSignals(selectedMessage, valuesByName);
    setDbcBytes(bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "));
  };

  const handleSendDbc = async () => {
    if (!selectedMessage) return;
    const bytes = parseByteString(dbcBytes);
    if (!bytes) {
      showToast("Enter up to 8 hex bytes, space-separated (e.g. 01 02 0A)", "failure");
      return;
    }
    setSending(true);
    try {
      const result = await sendCommand(selectedMessage.id, 1, bytes, dbcIdType);
      if (result?.success) {
        showToast(`Sent ${selectedMessage.name} (0x${selectedMessage.id.toString(16).toUpperCase()})`, "success");
      } else {
        showToast(`Send failed: ${result?.error || "unknown error"}`, "failure");
      }
    } finally {
      setSending(false);
    }
  };

  const handleSendRaw = async () => {
    const idNum = parseCanId(rawId);
    const bytes = parseByteString(rawBytes);
    if (idNum === null) {
      showToast("Enter a valid CAN ID (hex like 0x520, or decimal)", "failure");
      return;
    }
    if (rawIdType === 0 && idNum > 0x7ff) {
      showToast("ID doesn't fit in 11 bits — pick Extended, or use a smaller ID", "failure");
      return;
    }
    if (!bytes) {
      showToast("Enter up to 8 hex bytes, space-separated (e.g. 01 02 0A)", "failure");
      return;
    }
    setSending(true);
    try {
      const result = await sendCommand(idNum, 1, bytes, rawIdType);
      if (result?.success) {
        showToast(`Sent 0x${idNum.toString(16).toUpperCase()}`, "success");
      } else {
        showToast(`Send failed: ${result?.error || "unknown error"}`, "failure");
      }
    } finally {
      setSending(false);
    }
  };

  // "+ Add to List" saves whatever's currently configured in the form (DBC
  // or Raw mode, whichever is active) as a new Tx Frame List row instead of
  // sending it immediately - see useTxFrameList.js / TxFrameListCard below.
  const handleAddToListDbc = () => {
    if (!selectedMessage) return;
    const bytes = parseByteString(dbcBytes);
    if (!bytes) {
      showToast("Enter up to 8 hex bytes, space-separated (e.g. 01 02 0A)", "failure");
      return;
    }
    txFrameList.addRow({ name: selectedMessage.name, id: selectedMessage.id, idType: dbcIdType, data: bytes });
    showToast(`Added ${selectedMessage.name} to Tx Frame List`, "success");
  };

  const handleAddToListRaw = () => {
    const idNum = parseCanId(rawId);
    const bytes = parseByteString(rawBytes);
    if (idNum === null) {
      showToast("Enter a valid CAN ID (hex like 0x520, or decimal)", "failure");
      return;
    }
    if (rawIdType === 0 && idNum > 0x7ff) {
      showToast("ID doesn't fit in 11 bits — pick Extended, or use a smaller ID", "failure");
      return;
    }
    if (!bytes) {
      showToast("Enter up to 8 hex bytes, space-separated (e.g. 01 02 0A)", "failure");
      return;
    }
    txFrameList.addRow({ name: `0x${idNum.toString(16).toUpperCase()}`, id: idNum, idType: rawIdType, data: bytes });
    showToast(`Added 0x${idNum.toString(16).toUpperCase()} to Tx Frame List`, "success");
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card-title" style={{ marginBottom: 0 }}>Transmit</div>

      {dbc && (
        <div className="tab-bar" style={{ width: "fit-content" }}>
          <button className={mode === "dbc" ? "active" : ""} onClick={() => setMode("dbc")}>
            From DBC
          </button>
          <button className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}>
            Raw ID + Bytes
          </button>
        </div>
      )}

      {!connected && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--warning)", fontWeight: 600, fontSize: 13 }}>
          <span>⚠</span> Not connected — connect a tool from the sidebar before sending.
        </div>
      )}

      {mode === "dbc" && dbc ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div className="field" style={{ maxWidth: 420, flex: "1 1 320px" }}>
              <label>Message</label>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                <option value="">Select a message to transmit…</option>
                {dbcMessages.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — 0x{m.id.toString(16).toUpperCase()} ({m.sender})
                  </option>
                ))}
              </select>
            </div>
            {selectedMessage && (
              <div className="field" style={{ minWidth: 170 }}>
                <label>ID Type</label>
                <select value={dbcIdType} onChange={(e) => setDbcIdType(Number(e.target.value))}>
                  <option value={1}>Extended (29-bit)</option>
                  <option value={0} disabled={selectedMessage.id > 0x7ff}>
                    Standard (11-bit){selectedMessage.id > 0x7ff ? " — id too large" : ""}
                  </option>
                </select>
              </div>
            )}
          </div>

          {selectedMessage && (
            <>
              <div className="field" style={{ maxWidth: 460 }}>
                <label>Data Bytes (hex, space-separated, up to 8)</label>
                <input type="text" value={dbcBytes} onChange={(e) => setDbcBytes(e.target.value)} className="mono" />
                {!dbcPreviewBytes && (
                  <span className="field-hint" style={{ color: "var(--danger)" }}>
                    Invalid — enter up to 8 hex bytes, space-separated
                  </span>
                )}
              </div>

              {selectedMessage.signals.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                  This message has no signals defined in the DBC.
                </div>
              ) : (
                dbcPreviewSignals && (
                  <div style={{ maxWidth: 460, overflow: "auto" }}>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 6, fontWeight: 600 }}>
                      {selectedMessage.name} signals — edit a physical value or the bytes above, either stays in sync
                    </div>
                    <table className="raw-monitor-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th style={{ width: 130 }}>Physical</th>
                          <th style={{ width: 60 }}>Units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dbcPreviewSignals.map((sig) => {
                          // A DBC signal's range is frequently just what its
                          // bit width can hold (e.g. 2 bits -> [0|3]), not a
                          // separate business-logic limit - either way the
                          // hardware/wire format genuinely can't carry more,
                          // so the field is capped to it rather than letting
                          // Send silently clamp with no explanation.
                          const hasRange = sig.min !== null || sig.max !== null;
                          return (
                            <tr key={sig.name}>
                              <td>
                                {sig.name}
                                {hasRange && (
                                  <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 400 }}>
                                    range {sig.min ?? "—"} to {sig.max ?? "—"}
                                  </div>
                                )}
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="any"
                                  min={sig.min ?? undefined}
                                  max={sig.max ?? undefined}
                                  value={sig.value === null ? "" : sig.value}
                                  onChange={(e) => handleSignalValueChange(sig.name, e.target.value)}
                                  className="mono"
                                  style={{ padding: "4px 8px", fontSize: 12.5 }}
                                  title={hasRange ? `Allowed range: ${sig.min ?? "—"} to ${sig.max ?? "—"}` : undefined}
                                />
                              </td>
                              <td>{sig.unit || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" disabled={!connected || sending || !dbcPreviewBytes} onClick={handleSendDbc}>
                  {sending ? "Sending…" : `Send ${selectedMessage.name}`}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={!dbcPreviewBytes}
                  onClick={handleAddToListDbc}
                  title="Save this frame to the Tx Frame List for repeated/periodic sending"
                >
                  + Add to List
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 160 }}>
            <label>CAN ID</label>
            <input
              type="text"
              placeholder="0x520 or decimal"
              value={rawId}
              onChange={(e) => {
                setRawId(e.target.value);
                // A pasted/typed id that no longer fits in 11 bits should
                // stop claiming to be Standard by default - flip to
                // Extended automatically rather than silently letting the
                // next Send just fail the range check above.
                const idNum = parseCanId(e.target.value);
                if (idNum !== null && idNum > 0x7ff) setRawIdType(1);
              }}
            />
          </div>
          <div className="field" style={{ minWidth: 170 }}>
            <label>ID Type</label>
            <select value={rawIdType} onChange={(e) => setRawIdType(Number(e.target.value))}>
              <option value={1}>Extended (29-bit)</option>
              <option value={0}>Standard (11-bit)</option>
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 300px", minWidth: 260 }}>
            <label>Data Bytes (hex, space-separated, up to 8)</label>
            <input type="text" value={rawBytes} onChange={(e) => setRawBytes(e.target.value)} className="mono" />
          </div>
          <button className="btn btn-primary" disabled={!connected || sending} onClick={handleSendRaw}>
            {sending ? "Sending…" : "Send"}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleAddToListRaw}
            title="Save this frame to the Tx Frame List for repeated/periodic sending"
          >
            + Add to List
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Tx Frame List (BUSMASTER's Transmit Message window): the saved-frames
 * table below the single-frame Transmit form. Each row can be sent once,
 * toggled into its own periodic auto-send interval, or removed; "Play
 * Sequence" walks the whole list top to bottom, one send at a time, with the
 * currently-sending row highlighted - see useTxFrameList.js for the actual
 * timer/sequence logic, this component is purely the table + controls.
 */
function TxFrameListCard({ txFrameList, connected, showToast }) {
  const { rows, removeRow, clearRows, setRepetition, togglePeriodic, sendRow, playing, playingRowId, playSequence, stopSequence } =
    txFrameList;

  const handleSendOnce = async (row) => {
    const result = await sendRow(row);
    if (result?.success) {
      showToast(`Sent ${row.name}`, "success");
    } else {
      showToast(`Send failed: ${result?.error || "unknown error"}`, "failure");
    }
  };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div className="card-title" style={{ margin: 0 }}>
          Tx Frame List ({rows.length})
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`btn ${playing ? "btn-primary" : "btn-secondary"}`}
            disabled={!connected || rows.length === 0}
            onClick={playing ? stopSequence : playSequence}
            style={{ fontSize: 12, padding: "6px 12px" }}
            title="Send every row in the list, top to bottom, one at a time"
          >
            {playing ? "⏹ Stop Sequence" : "▶ Play Sequence"}
          </button>
          <button
            className="btn btn-secondary"
            disabled={rows.length === 0}
            onClick={clearRows}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            🗑 Delete All
          </button>
        </div>
      </div>

      {!connected && rows.length > 0 && (
        <div style={{ padding: "10px 18px 0", display: "flex", gap: 10, alignItems: "center", color: "var(--warning)", fontWeight: 600, fontSize: 12.5 }}>
          <span>⚠</span> Not connected — sends (periodic and Play Sequence) will fail until a tool is connected.
        </div>
      )}

      <div style={{ overflow: "auto", maxHeight: "40vh" }}>
        <table className="raw-monitor-table">
          <thead>
            <tr>
              <th>Message Name</th>
              <th style={{ width: 108 }}>Frame ID</th>
              <th style={{ width: 78 }}>Type</th>
              <th style={{ width: 40 }}>DLC</th>
              <th style={{ width: 190 }}>Data Bytes</th>
              <th style={{ width: 110 }}>Repetition (ms)</th>
              <th style={{ width: 70 }}>Periodic</th>
              <th style={{ width: 130 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty-state" style={{ padding: 30 }}>
                    <span className="empty-icon">📋</span>
                    <span>No saved frames yet — use "+ Add to List" above to build a list you can replay or auto-send.</span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.rowId}
                  style={{
                    background: playingRowId === row.rowId ? "var(--accent-bg, var(--bms-accent-bg))" : undefined,
                    transition: "background 0.15s ease",
                  }}
                >
                  <td>{row.name}</td>
                  <td className="mono">0x{row.id.toString(16).toUpperCase()}</td>
                  <td>
                    <span className="badge badge-neutral" style={{ padding: "2px 7px", fontSize: 10.5 }}>
                      {row.idType === 1 ? "Extended" : "Standard"}
                    </span>
                  </td>
                  <td className="mono">{row.data.length}</td>
                  <td className="mono">{row.data.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</td>
                  <td>
                    <input
                      type="number"
                      min={50}
                      step={50}
                      value={row.repetitionMs}
                      onChange={(e) => setRepetition(row.rowId, Number(e.target.value))}
                      className="mono"
                      style={{ padding: "4px 8px", fontSize: 12.5, width: "100%" }}
                    />
                  </td>
                  <td>
                    <label style={{ display: "flex", justifyContent: "center", cursor: "pointer" }} title="Auto-send this frame repeatedly at the interval above">
                      <input
                        type="checkbox"
                        checked={row.periodic}
                        disabled={!connected && !row.periodic}
                        onChange={() => togglePeriodic(row.rowId)}
                        style={{ width: "auto" }}
                      />
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn-ghost"
                        disabled={!connected}
                        onClick={() => handleSendOnce(row)}
                        style={{ fontSize: 11, padding: "4px 8px" }}
                        title="Send once"
                      >
                        Send
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => removeRow(row.rowId)}
                        style={{ fontSize: 11, padding: "4px 8px", color: "var(--danger)" }}
                        title="Remove from list"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseCanId(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = trimmed.toLowerCase().startsWith("0x") ? parseInt(trimmed, 16) : parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseByteString(text) {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 8) return null;
  const bytes = parts.map((p) => parseInt(p, 16));
  if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) return null;
  while (bytes.length < 8) bytes.push(0);
  return bytes;
}

function formatSignalValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
