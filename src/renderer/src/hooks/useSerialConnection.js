import { useCallback, useEffect, useState } from "react";

/** Owns serial-port enumeration + connect/disconnect state for the renderer. */
export function useSerialConnection() {
  const [ports, setPorts] = useState([]);
  const [status, setStatus] = useState({ connected: false, path: null, baudRate: null });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refreshPorts = useCallback(async () => {
    try {
      const list = await window.canApi.listPorts();
      setPorts(list);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    refreshPorts();
    window.canApi.getStatus().then(setStatus).catch(() => {});
    const unsubStatus = window.canApi.onStatus((s) => setStatus(s));
    const unsubError = window.canApi.onError((message) => setError(message));
    const unsubPorts = window.canApi.onPortsChanged(() => refreshPorts());
    return () => {
      unsubStatus();
      unsubError();
      unsubPorts();
    };
  }, [refreshPorts]);

  const connect = useCallback(async (portPath, baudRate) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.canApi.connect(portPath, baudRate);
      if (!result.success) setError(result.error || "Failed to connect");
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      return await window.canApi.disconnect();
    } finally {
      setBusy(false);
    }
  }, []);

  return { ports, status, error, busy, refreshPorts, connect, disconnect, setError };
}
