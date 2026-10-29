import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import ConnectionSetup from "./components/ConnectionSetup.jsx";
import Login from "./components/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { ToastProvider, useToast } from "./lib/toast.jsx";
import { useAuth } from "./hooks/useAuth.js";
import { useSerialConnection } from "./hooks/useSerialConnection.js";
import { usePcanConnection } from "./hooks/usePcanConnection.js";
import { useCanLiveData } from "./hooks/useCanLiveData.js";
import { useRs485Keepalive } from "./hooks/useRs485Keepalive.js";
import { useDbc } from "./hooks/useDbc.js";
import { useLiveCanGrid } from "./hooks/useLiveCanGrid.js";
import { useRawFrameLog } from "./hooks/useRawFrameLog.js";
import { useTxFrameList } from "./hooks/useTxFrameList.js";
import { useFrameLogging } from "./hooks/useFrameLogging.js";
import { useTheme } from "./hooks/useTheme.js";

import BmsDashboard from "./pages/bms/BmsDashboard.jsx";
import BmsConfiguration from "./pages/bms/BmsConfiguration.jsx";
import BmsControlCenter from "./pages/bms/BmsControlCenter.jsx";
import BmsWarnings from "./pages/bms/BmsWarnings.jsx";
import BmsParallel from "./pages/bms/BmsParallel.jsx";
import BmsFirmware from "./pages/bms/BmsFirmware.jsx";

import RbmsDashboard from "./pages/rbms/RbmsDashboard.jsx";
import RbmsConfiguration from "./pages/rbms/RbmsConfiguration.jsx";
import RbmsCommandCenter from "./pages/rbms/RbmsCommandCenter.jsx";
import RbmsFirmware from "./pages/rbms/RbmsFirmware.jsx";
import BmuData from "./pages/rbms/BmuData.jsx";
import PendingPage from "./pages/rbms/PendingPage.jsx";
import ProtectionParameters from "./pages/rbms/ProtectionParameters.jsx";
import BmuIdentityConfig from "./pages/rbms/BmuIdentityConfig.jsx";

import RawMonitor from "./pages/RawMonitor.jsx";
import LiveMonitor from "./pages/LiveMonitor.jsx";

export default function App() {
  useEffect(() => {
    // Gate raw serial RX/TX hex dumps behind an opt-in flag so the console
    // stays quiet by default. Toggle from DevTools with:
    //   window.__DEBUG_SERIAL__ = true
    const unsubscribe = window.canApi.onDebug((message) => {
      if (window.__DEBUG_SERIAL__) console.log("[serial]", message);
    });
    return unsubscribe;
  }, []);

  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const auth = useAuth();
  const [deviceType, setDeviceType] = useState(null);
  // Both transports share status/data/error events (see preload.js), but
  // disconnect() must be called on whichever transport is actually active -
  // ConnectionSetup reports that alongside the device type once connected.
  // "rs485" and "aeidthCanTool" are both the `serial` transport at the code
  // level (same COM-port link) - only rs485 needs the keepalive poll below.
  const [activeTransport, setActiveTransport] = useState("serial");
  const serialConnection = useSerialConnection();
  const pcanConnection = usePcanConnection();
  const connection = activeTransport === "pcan" ? pcanConnection : serialConnection;
  const { liveData, dataStatus, resetConfigBuffer, resetLiveData } = useCanLiveData(deviceType);
  // Lifted here (rather than inside RawMonitor/LiveMonitor) for the same
  // reason useCanLiveData is: Shell stays mounted across route changes, but
  // a page component under <Routes> gets unmounted/remounted every time you
  // navigate away and back, which would otherwise silently drop the DBC and
  // reset the live grid/log to empty on every tab switch.
  const dbcState = useDbc();
  const liveGrid = useLiveCanGrid();
  const rawFrameLog = useRawFrameLog();
  const txFrameList = useTxFrameList();
  const frameLogging = useFrameLogging(dbcState.dbc);
  const { theme, cycleTheme } = useTheme();
  const showToast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    return window.canApi.onLogError((message) => showToast(message, "failure"));
  }, [showToast]);

  useRs485Keepalive({
    enabled: activeTransport === "rs485",
    connected: connection.status.connected,
    isFirmwareRoute: location.pathname.endsWith("/firmware"),
  });

  // Auto-route to the right root once a mode is picked.
  useEffect(() => {
    if (deviceType && location.pathname === "/") {
      navigate(`/${deviceType}`, { replace: true });
    }
  }, [deviceType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Give each mode its own accent color (blue for BMS, purple/amber for RBMS)
  // by setting CSS variables consumed throughout global.css / inline styles.
  // --accent-bg is the translucent tint version (used for editing-state
  // highlights etc.) - kept in sync with --accent so both stay mode-correct.
  useEffect(() => {
    const root = document.documentElement;
    if (deviceType === "bms") {
      root.style.setProperty("--accent", "var(--bms-accent)");
      root.style.setProperty("--accent-bg", "var(--bms-accent-bg)");
    } else if (deviceType === "rbms") {
      root.style.setProperty("--accent", "var(--rbms-accent)");
      root.style.setProperty("--accent-bg", "var(--rbms-accent-bg)");
    }
  }, [deviceType]);

  if (!auth.isAuthenticated) {
    return <Login onLogin={auth.login} busy={auth.busy} error={auth.error} />;
  }

  if (!deviceType) {
    return (
      <ConnectionSetup
        onReady={(type, transport) => {
          setDeviceType(type);
          setActiveTransport(transport || "serial");
          navigate(`/${type}`, { replace: true });
        }}
      />
    );
  }

  const handleSwitchMode = () => {
    setDeviceType(null);
    navigate("/", { replace: true });
  };

  const ctx = {
    deviceType,
    connection,
    liveData,
    dataStatus,
    resetConfigBuffer,
    resetLiveData,
    dbcState,
    liveGrid,
    rawFrameLog,
    txFrameList,
    frameLogging,
  };

  return (
    <div className="app-shell">
      <Sidebar
        deviceType={deviceType}
        status={connection.status}
        onSwitchMode={handleSwitchMode}
        onDisconnect={connection.disconnect}
        onLogout={auth.logout}
        theme={theme}
        onCycleTheme={cycleTheme}
      />
      <div className="main-scroll">
        <Routes>
          <Route path="/" element={<Navigate to={`/${deviceType}`} replace />} />

          <Route path="/bms" element={<BmsDashboard {...ctx} />} />
          <Route path="/bms/config" element={<BmsConfiguration {...ctx} />} />
          <Route path="/bms/control-center" element={<BmsControlCenter {...ctx} />} />
          <Route path="/bms/warnings" element={<BmsWarnings {...ctx} />} />
          <Route path="/bms/parallel" element={<BmsParallel {...ctx} />} />
          <Route path="/bms/firmware" element={<BmsFirmware {...ctx} />} />

          <Route path="/rbms" element={<RbmsDashboard {...ctx} />} />
          <Route path="/rbms/config" element={<RbmsConfiguration {...ctx} />} />
          <Route path="/rbms/command-center" element={<RbmsCommandCenter {...ctx} />} />
          <Route path="/rbms/firmware" element={<RbmsFirmware {...ctx} />} />
          <Route path="/rbms/bmu" element={<BmuData {...ctx} />} />
          <Route path="/rbms/protection" element={<ProtectionParameters {...ctx} />} />
          <Route path="/rbms/bmu-config" element={<BmuIdentityConfig {...ctx} />} />
          <Route
            path="/rbms/bmu-firmware"
            element={<PendingPage {...ctx} title="BMU Firmware Update" subtitle="Update firmware on individual BMUs." />}
          />

          <Route path="/raw-monitor" element={<RawMonitor {...ctx} />} />
          <Route path="/live-monitor" element={<LiveMonitor {...ctx} />} />

          <Route path="*" element={<Navigate to={`/${deviceType}`} replace />} />
        </Routes>
      </div>
    </div>
  );
}
