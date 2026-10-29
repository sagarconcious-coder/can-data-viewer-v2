import { useCallback, useState } from "react";
import { parseDbc } from "../lib/dbcParser.js";

// Persisted as the raw DBC source text (not the parsed Map, which doesn't
// survive JSON/localStorage) plus the filename - re-parsing on load is cheap
// and means there's only ever one source of truth for what "the loaded DBC"
// actually contains. localStorage is per-artifact-origin in a browser tab,
// but this is a real Electron app loading a fixed local file - the origin is
// stable across restarts, so this genuinely persists between launches, not
// just tab switches.
const STORAGE_KEY = "cdv.dbc.v1";

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { fileName, text } = JSON.parse(raw);
    if (!fileName || typeof text !== "string") return null;
    const parsed = parseDbc(text);
    return { fileName, messages: parsed.messages, text };
  } catch {
    // Corrupt/incompatible stored value, or the stored DBC no longer parses
    // (e.g. this app's DBC parser changed) - fall back to "no DBC loaded"
    // rather than throwing on every app start.
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * Loads and holds a user-uploaded DBC file's parsed message/signal
 * definitions. Lives in Shell (App.jsx), same level as useCanLiveData, so it
 * survives switching between pages/routes - and persists its raw text to
 * localStorage so it also survives closing and reopening the app, without
 * needing to re-upload the file. Swapping in a new file replaces the
 * previous one outright.
 */
export function useDbc() {
  const [dbc, setDbc] = useState(loadPersisted); // { fileName, messages: Map, text }
  const [error, setError] = useState(null);

  const loadDbcFile = useCallback(async (file) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseDbc(text);
      setDbc({ fileName: file.name, messages: parsed.messages, text });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ fileName: file.name, text }));
      } catch {
        // Storage full/unavailable (e.g. private mode) - the DBC still works
        // for this session, it just won't survive a restart. Not worth
        // surfacing as an error for what's a convenience feature.
      }
      return { success: true, messageCount: parsed.messages.size };
    } catch (err) {
      setError(err.message);
      setDbc(null);
      return { success: false, error: err.message };
    }
  }, []);

  const clearDbc = useCallback(() => {
    setDbc(null);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { dbc, error, loadDbcFile, clearDbc };
}
