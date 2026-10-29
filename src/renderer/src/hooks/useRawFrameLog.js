import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapCanFrame } from "../lib/canFrame.js";

// Cap the in-memory log so a long-running capture (RS485/PEAK CAN can both
// easily push hundreds of frames/sec) doesn't grow the row array without
// bound and eventually choke the render/table. Oldest rows drop off first,
// same as BUSMASTER's message window in practice.
const MAX_ROWS = 5000;
let rowSeq = 0;

/**
 * Subscribes to the raw RX/TX frame stream (transport-agnostic: RS485/serial
 * "Aeidth CAN Tool" and PEAK PCAN-USB both funnel through the same IPC
 * channels, see preload.js) and keeps a capped, filterable log of decoded
 * rows for the Raw Monitor page - the BUSMASTER-style Message Window.
 */
export function useRawFrameLog() {
  const [rows, setRows] = useState([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const pushRow = useCallback((frame, direction) => {
    if (pausedRef.current) return;
    const unwrapped = unwrapCanFrame(frame);
    if (!unwrapped) return;
    const row = {
      seq: ++rowSeq,
      time: new Date(),
      direction, // "Rx" | "Tx"
      ...unwrapped,
    };
    setRows((prev) => {
      const next = prev.length >= MAX_ROWS ? prev.slice(prev.length - MAX_ROWS + 1) : prev;
      return [...next, row];
    });
  }, []);

  useEffect(() => {
    const unsubData = window.canApi.onData((frame) => pushRow(frame, "Rx"));
    const unsubTx = window.canApi.onTxFrame((frame) => pushRow(frame, "Tx"));
    return () => {
      unsubData();
      unsubTx();
    };
  }, [pushRow]);

  const clear = useCallback(() => setRows([]), []);

  return { rows, paused, setPaused, clear };
}
