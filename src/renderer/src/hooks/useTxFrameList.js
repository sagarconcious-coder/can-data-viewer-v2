import { useCallback, useEffect, useRef, useState } from "react";
import { sendCommand } from "../lib/canCommands.js";

let rowSeq = 0;
const DEFAULT_REPETITION_MS = 1000;
// Gap between frames while "Play Sequence" walks the list line by line -
// distinct from each row's own Repetition field (that one drives periodic
// auto-send instead, see below). Kept short but non-zero so frames are
// visibly distinguishable on a bus trace / the Live/Raw monitor pages rather
// than arriving as an indistinguishable burst.
const SEQUENCE_STEP_MS = 150;

/**
 * Owns the "Tx Frame List" (BUSMASTER's Transmit Message window): a list of
 * saved CAN frames the user builds up, each independently:
 *  - sendable once on demand,
 *  - toggled into periodic auto-send at its own Repetition (ms) interval,
 *  - or driven by "Play Sequence", which walks every row in the list in
 *    order with a short gap between each, one send at a time.
 *
 * Lives in Shell (App.jsx), same as useDbc/useLiveCanGrid/useRawFrameLog, so
 * the list (and any periodic timers/an in-flight sequence) survive switching
 * tabs instead of being torn down every time the Live CAN Grid page unmounts.
 */
export function useTxFrameList() {
  const [rows, setRows] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [playingRowId, setPlayingRowId] = useState(null);
  const timersRef = useRef(new Map()); // rowId -> interval handle
  const rowsRef = useRef(rows); // always-current snapshot for timer callbacks
  rowsRef.current = rows;
  const playAbortRef = useRef(false);

  const sendRow = useCallback(async (row) => {
    return sendCommand(row.id, 1, row.data, row.idType);
  }, []);

  const stopPeriodic = useCallback((rowId) => {
    const timer = timersRef.current.get(rowId);
    if (timer) {
      clearInterval(timer);
      timersRef.current.delete(rowId);
    }
  }, []);

  const startPeriodic = useCallback(
    (rowId, repetitionMs) => {
      stopPeriodic(rowId);
      const timer = setInterval(() => {
        const target = rowsRef.current.find((r) => r.rowId === rowId);
        if (target) sendRow(target).catch(() => {});
      }, Math.max(50, repetitionMs || DEFAULT_REPETITION_MS));
      timersRef.current.set(rowId, timer);
    },
    [sendRow, stopPeriodic],
  );

  const addRow = useCallback((frame) => {
    const row = {
      rowId: ++rowSeq,
      name: frame.name,
      id: frame.id,
      idType: frame.idType, // 0 = standard, 1 = extended
      data: frame.data,
      repetitionMs: DEFAULT_REPETITION_MS,
      periodic: false,
    };
    setRows((prev) => [...prev, row]);
    return row.rowId;
  }, []);

  const removeRow = useCallback(
    (rowId) => {
      stopPeriodic(rowId);
      setRows((prev) => prev.filter((r) => r.rowId !== rowId));
    },
    [stopPeriodic],
  );

  const clearRows = useCallback(() => {
    for (const timer of timersRef.current.values()) clearInterval(timer);
    timersRef.current.clear();
    setRows([]);
  }, []);

  const setRepetition = useCallback(
    (rowId, ms) => {
      setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, repetitionMs: ms } : r)));
      // If it's already running, restart at the new interval immediately
      // rather than waiting for a manual toggle off/on.
      if (timersRef.current.has(rowId)) startPeriodic(rowId, ms);
    },
    [startPeriodic],
  );

  const togglePeriodic = useCallback(
    (rowId) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.rowId !== rowId) return r;
          const next = !r.periodic;
          if (next) startPeriodic(rowId, r.repetitionMs);
          else stopPeriodic(rowId);
          return { ...r, periodic: next };
        }),
      );
    },
    [startPeriodic, stopPeriodic],
  );

  // "Play Sequence": sends every row top to bottom, one at a time, with a
  // short gap between each - the "list of packets go line by line" request.
  // Runs independently of any row's own periodic toggle (both can be active
  // at once; they just interleave on the wire).
  const playSequence = useCallback(async () => {
    if (playing) return;
    playAbortRef.current = false;
    setPlaying(true);
    try {
      // Snapshot the row list at play-start so edits/deletes made mid-run
      // don't shift what's being iterated out from under it.
      const snapshot = rowsRef.current;
      for (const row of snapshot) {
        if (playAbortRef.current) break;
        setPlayingRowId(row.rowId);
        await sendRow(row).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, SEQUENCE_STEP_MS));
      }
    } finally {
      setPlayingRowId(null);
      setPlaying(false);
    }
  }, [playing, sendRow]);

  const stopSequence = useCallback(() => {
    playAbortRef.current = true;
  }, []);

  // Stop every running periodic timer on unmount (app close/hot-reload) -
  // this hook lives in Shell for the app's whole lifetime otherwise, so this
  // only actually matters for dev hot-reload, but it's the correct cleanup.
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearInterval(timer);
      timersRef.current.clear();
    };
  }, []);

  return {
    rows,
    addRow,
    removeRow,
    clearRows,
    setRepetition,
    togglePeriodic,
    sendRow,
    playing,
    playingRowId,
    playSequence,
    stopSequence,
  };
}
