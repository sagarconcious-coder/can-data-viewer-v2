import React, { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import { decodeSignals } from "../lib/dbcParser.js";
import { useToast } from "../lib/toast.jsx";

/**
 * Raw CAN traffic monitor - a BUSMASTER "Message Window" equivalent inside
 * this app. Works identically regardless of which tool is actually plugged
 * in (RS485/Aeidth CAN Tool over serial, or a PEAK PCAN-USB adapter) because
 * both transports funnel every frame through the same onData/onTxFrame IPC
 * events in the legacy 21-byte shape - see useRawFrameLog.js.
 *
 * Uploading a .dbc file (any standard Vector DBC, not just this project's
 * bundled one) resolves each frame's message name and decoded signal values
 * from that file instead of the app's own hard-coded CAN_ID table - see
 * dbcParser.js. Without a DBC loaded, behavior is unchanged: only ids this
 * app already knows about (protocol.CAN_ID) get a name, and no signals are
 * shown.
 *
 * `rawFrameLog` and `dbcState` are owned by Shell (App.jsx), not this
 * component - it stays mounted across route/tab changes, so both the frame
 * log and the loaded DBC keep running/persisting in the background instead
 * of being reset every time this page unmounts.
 */
export default function RawMonitor({ connection, dataStatus, rawFrameLog, dbcState }) {
  const { rows, paused, setPaused, clear } = rawFrameLog;
  const { dbc, error: dbcError, loadDbcFile, clearDbc } = dbcState;
  const [idFilter, setIdFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("all"); // all | rx | tx
  const [typeFilter, setTypeFilter] = useState("all"); // all | standard | extended
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedSeq, setExpandedSeq] = useState(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const showToast = useToast();

  const handleDbcFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const result = await loadDbcFile(file);
    if (result.success) {
      showToast(`Loaded ${file.name} — ${result.messageCount} messages`, "success");
    } else {
      showToast(`Failed to parse ${file.name}: ${result.error}`, "failure");
    }
  };

  // Resolve each row's DBC message def (if a DBC is loaded and knows this
  // id) once per render pass, memoized on the row set + active DBC so
  // re-filtering alone doesn't redo the lookup/decode work.
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

  // Comma/space separated list of hex or decimal CAN ids to match against.
  // Each term matches as a case-insensitive substring of the row's hex id
  // (with or without "0x") or its exact decimal value, and also against the
  // resolved message name - so typing "18963257", "0x18963257", or
  // "hearthbeat" all find the same traffic.
  const filterTerms = useMemo(
    () =>
      idFilter
        .split(/[,\s]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    [idFilter],
  );

  const filteredRows = useMemo(() => {
    return decoratedRows.filter((row) => {
      if (directionFilter !== "all" && row.direction.toLowerCase() !== directionFilter) return false;
      if (typeFilter !== "all" && row.idType.toLowerCase() !== typeFilter) return false;
      if (filterTerms.length === 0) return true;
      const hexNoPrefix = row.idHex.toLowerCase().replace(/^0x/, "");
      const decStr = String(row.id);
      const nameStr = (row.name || "").toLowerCase();
      return filterTerms.some(
        (term) =>
          hexNoPrefix.includes(term.replace(/^0x/, "")) || decStr === term || nameStr.includes(term),
      );
    });
  }, [decoratedRows, filterTerms, directionFilter, typeFilter]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredRows, autoScroll]);

  const rxCount = rows.length ? rows.filter((r) => r.direction === "Rx").length : 0;
  const txCount = rows.length - rxCount;

  return (
    <div className="page-container page-container-wide">
      <PageHeader
        title="Raw CAN Monitor"
        subtitle={
          connection.status.connected
            ? `Live traffic on ${connection.status.path} @ ${connection.status.baudRate} — works with any connected tool (RS485/Aeidth CAN Tool or PEAK PCAN-USB)`
            : "Not connected — connect a tool from the sidebar to see raw traffic"
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
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{dbc.messages.size} messages decoded from DBC</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 13 }}>No DBC loaded</div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Message names/signals fall back to this app's built-in CAN ID table
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

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 260px", minWidth: 220 }}>
            <label>Filter by CAN ID or name</label>
            <input
              type="text"
              placeholder="e.g. 0x520, 18963257, HeartBeat — comma separated"
              value={idFilter}
              onChange={(e) => setIdFilter(e.target.value)}
            />
          </div>

          <div className="field" style={{ minWidth: 140 }}>
            <label>Direction</label>
            <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="rx">Rx only</option>
              <option value="tx">Tx only</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: 150 }}>
            <label>ID Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">Standard + Extended</option>
              <option value="standard">Standard (11-bit)</option>
              <option value="extended">Extended (29-bit)</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={`btn ${paused ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setPaused((p) => !p)}
              title={paused ? "Resume capturing frames" : "Pause capturing frames"}
            >
              {paused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button className="btn btn-secondary" onClick={clear} title="Clear the log">
              🗑 Clear
            </button>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-muted)",
                padding: "0 6px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                style={{ width: "auto" }}
              />
              Autoscroll
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-faint)", flexWrap: "wrap" }}>
          <span>
            Showing <strong style={{ color: "var(--text)" }}>{filteredRows.length}</strong> / {rows.length} frames
          </span>
          <span>
            Rx <strong style={{ color: "var(--text)" }}>{rxCount}</strong>
          </span>
          <span>
            Tx <strong style={{ color: "var(--text)" }}>{txCount}</strong>
          </span>
          {paused && (
            <span style={{ color: "var(--warning)", fontWeight: 700 }}>⏸ Capture paused — new frames are not being recorded</span>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={scrollRef} style={{ overflow: "auto", maxHeight: "60vh" }}>
          <table className="raw-monitor-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Time</th>
                <th style={{ width: 48 }}>Dir</th>
                <th style={{ width: 108 }}>CAN ID</th>
                <th style={{ width: 78 }}>Type</th>
                <th>Message</th>
                <th style={{ width: 40 }}>DLC</th>
                <th style={{ width: 190 }}>Data Bytes</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state" style={{ padding: 40 }}>
                      <span className="empty-icon">📡</span>
                      <span>
                        {rows.length === 0
                          ? "No frames captured yet — waiting for traffic from the connected tool."
                          : "No frames match the current filter."}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isExpanded = expandedSeq === row.seq;
                  const canExpand = !!row.signals?.length;
                  return (
                    <React.Fragment key={row.seq}>
                      <tr
                        onClick={() => canExpand && setExpandedSeq(isExpanded ? null : row.seq)}
                        style={{ cursor: canExpand ? "pointer" : "default" }}
                        title={canExpand ? "Click to view decoded signals" : undefined}
                      >
                        <td className="mono">{formatTime(row.time)}</td>
                        <td>
                          <span
                            className={`badge ${row.direction === "Tx" ? "badge-warning" : "badge-success"}`}
                            style={{ padding: "2px 8px" }}
                          >
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
                          {canExpand && <span style={{ color: "var(--text-faint)", marginRight: 6 }}>{isExpanded ? "▾" : "▸"}</span>}
                          {row.name || <span style={{ color: "var(--text-faint)" }}>—</span>}
                          {row.dbcMessage && (
                            <span
                              className="badge badge-neutral"
                              style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10, verticalAlign: "middle" }}
                            >
                              DBC
                            </span>
                          )}
                        </td>
                        <td className="mono">{row.dlc}</td>
                        <td className="mono">{row.data.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</td>
                      </tr>
                      {isExpanded && canExpand && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--bg-sunken)", padding: "10px 14px 14px 46px" }}>
                            <div className="grid grid-4" style={{ gap: 10 }}>
                              {row.signals.map((sig) => (
                                <div key={sig.name} className="config-field">
                                  <label>{sig.name}</label>
                                  <span className="config-value mono">
                                    {sig.value === null ? "—" : formatSignalValue(sig.value)}
                                    {sig.unit && sig.value !== null ? ` ${sig.unit}` : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatSignalValue(value) {
  // Physical values from factor/offset math are frequently not round numbers
  // (e.g. 0.01 scaling) - 3 decimal places keeps them readable without
  // dumping full float precision.
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}
