import { useCallback, useEffect, useState } from "react";

/**
 * Owns PCAN-USB channel enumeration + connect/disconnect state for the
 * renderer. Mirrors useSerialConnection.js's shape exactly, but for the
 * PCANBasic.dll-backed transport (see src/main/pcanManager.js). Status,
 * data and error events arrive on the same canApi.onStatus/onData/onError
 * listeners as the serial transport, since only one is ever active.
 */
export function usePcanConnection() {
  const [channels, setChannels] = useState([]);
  const [baudRates, setBaudRates] = useState([]);
  const [status, setStatus] = useState({ connected: false, path: null, baudRate: null });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refreshChannels = useCallback(async () => {
    try {
      const list = await window.canApi.pcanListChannels();
      setChannels(list);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    refreshChannels();
    window.canApi.pcanListBaudRates().then(setBaudRates).catch(() => {});
    const unsubStatus = window.canApi.onStatus((s) => setStatus(s));
    const unsubError = window.canApi.onError((message) => setError(message));
    return () => {
      unsubStatus();
      unsubError();
    };
  }, [refreshChannels]);

  const connect = useCallback(async (channelId, baudKbps) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.canApi.pcanConnect(channelId, baudKbps);
      if (!result.success) setError(result.error || "Failed to connect");
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      return await window.canApi.pcanDisconnect();
    } finally {
      setBusy(false);
    }
  }, []);

  return { channels, baudRates, status, error, busy, refreshChannels, connect, disconnect, setError };
}
