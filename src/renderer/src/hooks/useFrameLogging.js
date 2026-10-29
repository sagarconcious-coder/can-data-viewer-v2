import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapCanFrame } from "../lib/canFrame.js";

/**
 * Drives "Start Logging"/"Stop Logging" on the Live CAN Grid page: appends
 * every raw RX/TX frame (timestamp, direction, id, type, resolved message
 * name, DLC, data bytes) to a file on disk while active, in either format:
 *  - "csv": comma-separated, .csv extension.
 *  - "txt": human-readable fixed-width text, saved as this app's own
 *    ".aeidth.log" extension (still plain text, just a distinguishing
 *    filename) - see frameLogger.js for the actual format/extension rules.
 * The actual file handle lives in the main process (frameLogger.js) - the
 * renderer has no filesystem access, so this only sends already-formatted
 * rows over IPC and asks main to drive the native Save dialog.
 *
 * `dbc` (from useDbc, passed in by the caller) resolves each logged row's
 * Message column exactly the same way RawMonitor/LiveMonitor's tables do -
 * a name in the log means "a loaded DBC recognizes this id", never this
 * app's own built-in protocol.CAN_ID table (see canFrame.js's header
 * comment for why that fallback was removed).
 *
 * Reuse behavior: the first Start ever this session always prompts for a
 * location (and a format - `pendingFormatChoice`). A later Start - after a
 * Stop, with a file already chosen - offers a choice (`pendingReuseChoice`,
 * surfaced to the page as a small confirm UI rather than a native dialog,
 * since it's a yes/no app decision not a filesystem operation) between
 * reusing that same file+format (starting it over fresh - see
 * frameLogger.js's start()) or picking a new location/format.
 */
export function useFrameLogging(dbc) {
  const [logging, setLogging] = useState(false);
  const [filePath, setFilePath] = useState(null);
  const [format, setFormat] = useState(null); // "csv" | "txt", of the last-used file
  const [pendingReuseChoice, setPendingReuseChoice] = useState(false); // true while the "same file or new?" prompt should be shown
  const [pendingFormatChoice, setPendingFormatChoice] = useState(false); // true while the "CSV or TXT?" prompt should be shown
  const loggingRef = useRef(logging);
  loggingRef.current = logging;
  const dbcRef = useRef(dbc);
  dbcRef.current = dbc;

  const appendFrame = useCallback((frame, direction) => {
    if (!loggingRef.current) return;
    const unwrapped = unwrapCanFrame(frame);
    if (!unwrapped) return;
    const dbcMessage = dbcRef.current?.messages.get(unwrapped.id) ?? null;
    window.canApi.logAppend({
      timestamp: new Date().toISOString(),
      direction,
      idHex: unwrapped.idHex,
      idType: unwrapped.idType,
      name: dbcMessage?.name ?? null,
      dlc: unwrapped.dlc,
      dataHex: unwrapped.data.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "),
    });
  }, []);

  useEffect(() => {
    const unsubData = window.canApi.onData((frame) => appendFrame(frame, "Rx"));
    const unsubTx = window.canApi.onTxFrame((frame) => appendFrame(frame, "Tx"));
    return () => {
      unsubData();
      unsubTx();
    };
  }, [appendFrame]);

  const beginWithFile = useCallback(async (path, fmt) => {
    const result = await window.canApi.logStart(path, fmt);
    if (result?.success) {
      setLogging(true);
      setFilePath(result.filePath);
      setFormat(result.format);
    }
    return result;
  }, []);

  /**
   * Call when the user clicks "Start Logging". If a file was already chosen
   * before (even in an earlier stopped session), sets `pendingReuseChoice`
   * instead of starting immediately. Otherwise sets `pendingFormatChoice` -
   * either way the page renders the corresponding prompt and calls one of
   * the resume-with-file or chooseFormat functions below.
   */
  const startLogging = useCallback(() => {
    if (filePath) {
      setPendingReuseChoice(true);
      return;
    }
    setPendingFormatChoice(true);
  }, [filePath]);

  const chooseFormat = useCallback(
    async (fmt) => {
      setPendingFormatChoice(false);
      const chosen = await window.canApi.logChooseFile(fmt);
      if (!chosen) return; // user cancelled the dialog
      return beginWithFile(chosen, fmt);
    },
    [beginWithFile],
  );

  const cancelFormatChoice = useCallback(() => setPendingFormatChoice(false), []);

  const resumeWithSameFile = useCallback(async () => {
    setPendingReuseChoice(false);
    if (!filePath) return;
    return beginWithFile(filePath, format);
  }, [filePath, format, beginWithFile]);

  const resumeWithNewFile = useCallback(() => {
    setPendingReuseChoice(false);
    setPendingFormatChoice(true);
  }, []);

  const cancelReuseChoice = useCallback(() => setPendingReuseChoice(false), []);

  const stopLogging = useCallback(async () => {
    const result = await window.canApi.logStop();
    setLogging(false);
    return result;
  }, []);

  return {
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
  };
}
