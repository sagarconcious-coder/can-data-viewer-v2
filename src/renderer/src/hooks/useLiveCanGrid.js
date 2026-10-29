import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapCanFrame } from "../lib/canFrame.js";

/**
 * Live per-ID CAN grid: unlike useRawFrameLog's append-only log, this keeps
 * exactly one row per CAN id. The first time an id is seen it's appended (in
 * first-seen order, so the table doesn't reorder/jump as traffic updates);
 * every later frame for that same id updates that row's data/timestamp in
 * place. This is the "Signal Watch" style view - see live vs. log distinction
 * requested for the Raw Monitor page.
 */
export function useLiveCanGrid() {
  const [rowsById, setRowsById] = useState(new Map());
  const [order, setOrder] = useState([]); // ids in first-seen order
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const handleFrame = useCallback((frame, direction) => {
    if (pausedRef.current) return;
    const unwrapped = unwrapCanFrame(frame);
    if (!unwrapped) return;
    const { id } = unwrapped;

    setRowsById((prev) => {
      const existing = prev.get(id);
      const next = new Map(prev);
      next.set(id, {
        ...unwrapped,
        direction,
        time: new Date(),
        updateCount: (existing?.updateCount ?? 0) + 1,
        // Flips on every update so a row can flash-highlight on change; the
        // consumer just needs to see this value change, not what it is.
        flashKey: (existing?.flashKey ?? 0) + 1,
      });
      return next;
    });
    setOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  useEffect(() => {
    const unsubData = window.canApi.onData((frame) => handleFrame(frame, "Rx"));
    const unsubTx = window.canApi.onTxFrame((frame) => handleFrame(frame, "Tx"));
    return () => {
      unsubData();
      unsubTx();
    };
  }, [handleFrame]);

  const clear = useCallback(() => {
    setRowsById(new Map());
    setOrder([]);
  }, []);

  const rows = order.map((id) => rowsById.get(id)).filter(Boolean);

  return { rows, paused, setPaused, clear };
}
