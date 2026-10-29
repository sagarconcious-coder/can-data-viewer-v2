import React, { useState } from "react";
import AeidthLogo from "./AeidthLogo.jsx";

/**
 * First screen the app shows, before ConnectionSetup - mirrors v1's login
 * gate. Authenticates against the aeidthocpp BMS backend (see
 * main/authManager.js / useAuth.js) using an email + password form.
 */
export default function Login({ onLogin, busy, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onLogin(email, password);
  };

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 20% 20%, rgba(47,111,237,0.12), transparent 45%), radial-gradient(circle at 80% 80%, rgba(138,79,224,0.12), transparent 45%), var(--bg)",
        overflow: "auto",
        padding: 24,
      }}
    >
      <form onSubmit={handleSubmit} className="card" style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <AeidthLogo size={72} />
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>CAN Data Viewer Pro</h1>
            <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 13 }}>Sign in to continue</p>
          </div>
        </div>

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12.5, fontWeight: 600 }}>{error}</div>
        )}

        <button type="submit" className="btn btn-primary" style={{ padding: "12px 0", fontSize: 14 }} disabled={!canSubmit}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
