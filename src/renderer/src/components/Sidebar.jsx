import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import { StatusBadge } from "./StatusBadge.jsx";
import AeidthLogo from "./AeidthLogo.jsx";
import { THEMES } from "../hooks/useTheme.js";

const BMS_NAV = [
  { to: "/bms", label: "Live Dashboard", icon: "▤", end: true },
  { to: "/bms/config", label: "Configuration", icon: "⚙" },
  { to: "/bms/control-center", label: "Control Center", icon: "◉" },
  { to: "/bms/warnings", label: "Warning Settings", icon: "⚠" },
  { to: "/bms/parallel", label: "Parallel View", icon: "‖" },
  { to: "/bms/firmware", label: "Firmware Update", icon: "⬆" },
  { to: "/live-monitor", label: "Live CAN Grid", icon: "⚡" },
  { to: "/raw-monitor", label: "Raw CAN Monitor", icon: "≣" },
];

const RBMS_NAV = [
  { to: "/rbms", label: "RBMS Data", icon: "▤", end: true },
  { to: "/rbms/protection", label: "Protection Parameters", icon: "⛨" },
  { to: "/rbms/command-center", label: "Command Center", icon: "◉" },
  { to: "/rbms/config", label: "RBMS Identity Configuration", icon: "⚙" },
  { to: "/rbms/firmware", label: "Firmware Update", icon: "⬆" },
  { to: "/rbms/bmu", label: "BMU Data", icon: "▦" },
  { to: "/rbms/bmu-config", label: "BMU Identity Configuration", icon: "⚙" },
  { to: "/rbms/bmu-firmware", label: "BMU Firmware Update", icon: "⇪" },
  { to: "/live-monitor", label: "Live Raw CAN Grid", icon: "⚡" },
  { to: "/raw-monitor", label: "Raw CAN Monitor", icon: "≣" },
];

// Persisted across restarts, same rationale as the DBC cache in useDbc.js -
// a real Electron app with a stable origin, not a browser tab, so this is a
// durable user preference rather than a per-tab convenience.
const COLLAPSE_STORAGE_KEY = "cdv.sidebar.collapsed.v1";

function loadCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Sidebar({ deviceType, status, onSwitchMode, onDisconnect, onLogout, theme, onCycleTheme }) {
  const nav = deviceType === "bms" ? BMS_NAV : RBMS_NAV;
  const accent = deviceType === "bms" ? "bms" : "rbms";
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const currentThemeMeta = THEMES.find((t) => t.id === theme) || THEMES[0];
  const currentThemeIcon = currentThemeMeta.icon;
  const currentThemeLabel = currentThemeMeta.label;

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore - collapse state just won't survive a restart
      }
      return next;
    });
  };

  return (
    <aside
      style={{
        width: collapsed ? 60 : 248,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        height: "100vh",
        transition: "width 0.15s ease",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: collapsed ? "16px 0" : "16px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: collapsed ? "column" : "row",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          gap: collapsed ? 10 : 10,
        }}
      >
        {collapsed ? (
          <AeidthLogo size={28} icon />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <AeidthLogo size={26} />
            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {deviceType === "bms" ? "BMS Mode" : "RBMS Mode"}
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: collapsed ? "column" : "row",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {onCycleTheme && (
            <button
              onClick={onCycleTheme}
              title={`Theme: ${currentThemeLabel} (click to change)`}
              aria-label="Change theme"
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-muted)",
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              {currentThemeIcon}
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-muted)",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ☰
          </button>
        </div>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: collapsed ? "14px 8px" : "14px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={collapsed ? item.label : undefined}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? "10px" : "10px 12px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              color: isActive ? "white" : "var(--text-muted)",
              background: isActive ? `var(--${accent}-accent)` : "transparent",
              transition: "all 0.12s ease",
              whiteSpace: collapsed ? "nowrap" : "normal",
              lineHeight: 1.3,
            })}
          >
            <span style={{ width: 16, textAlign: "center", opacity: 0.9, flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>

      <div
        style={{
          padding: collapsed ? "12px 8px" : 14,
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: collapsed ? "center" : "stretch",
          gap: 10,
        }}
      >
        {collapsed ? (
          <span
            title={status.connected ? "Connected" : "Disconnected"}
            className={`badge-dot`}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: status.connected ? "var(--success)" : "var(--danger)",
              boxShadow: status.connected ? "0 0 0 3px var(--success-bg)" : "none",
            }}
          />
        ) : (
          <>
            <StatusBadge connected={status.connected} />
            {status.connected && (
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {status.path} @ {status.baudRate} baud
              </div>
            )}
          </>
        )}
        <button
          className="btn btn-secondary"
          style={{ fontSize: collapsed ? 16 : 12, padding: collapsed ? "8px" : undefined, width: collapsed ? 34 : undefined }}
          onClick={onSwitchMode}
          title="Switch Mode"
        >
          {collapsed ? "⇄" : "Switch Mode"}
        </button>
        {status.connected && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: collapsed ? 16 : 12, padding: collapsed ? "8px" : undefined, width: collapsed ? 34 : undefined }}
            onClick={onDisconnect}
            title="Disconnect"
          >
            {collapsed ? "✕" : "Disconnect"}
          </button>
        )}
        {onLogout && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: collapsed ? 16 : 12, padding: collapsed ? "8px" : undefined, width: collapsed ? 34 : undefined }}
            onClick={onLogout}
            title="Log Out"
          >
            {collapsed ? "⏻" : "Log Out"}
          </button>
        )}
      </div>
    </aside>
  );
}
