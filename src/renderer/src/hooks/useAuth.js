import { useCallback, useState } from "react";

// Persisted across restarts, same rationale as the sidebar-collapse/DBC
// caches - a real Electron app with a stable origin, so a logged-in session
// surviving a restart is expected rather than a leak.
const SESSION_STORAGE_KEY = "cdv.auth.session.v1";

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore - session just won't survive a restart
  }
}

/**
 * Login state against the aeidthocpp BMS backend (bms/loginwithpassword,
 * called from main/authManager.js via canApi.login - see preload.js). The
 * token itself isn't currently attached to any other request; this only
 * gates entry to the app, mirroring how v1 required a login before use.
 */
export function useAuth() {
  const [session, setSession] = useState(loadSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const login = useCallback(async (email, password) => {
    setBusy(true);
    setError("");
    try {
      const result = await window.canApi.login(email.trim(), password);
      if (!result || !result.success) {
        const message = (result && result.error) || "Login failed";
        setError(message);
        return { success: false, error: message };
      }
      const next = { token: result.token, user: result.user || null };
      setSession(next);
      saveSession(next);
      return { success: true };
    } catch (err) {
      const message = err && err.message ? err.message : "Login failed";
      setError(message);
      return { success: false, error: message };
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    saveSession(null);
  }, []);

  return { session, isAuthenticated: !!session, busy, error, login, logout };
}
