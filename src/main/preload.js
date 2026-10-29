const { contextBridge, ipcRenderer } = require("electron");

/**
 * Safe, minimal bridge between the renderer (React, no node integration) and
 * the Electron main process, which owns the actual `serialport` instance.
 */
contextBridge.exposeInMainWorld("canApi", {
  listPorts: () => ipcRenderer.invoke("serial:list-ports"),
  connect: (portPath, baudRate) => ipcRenderer.invoke("serial:connect", { path: portPath, baudRate }),
  disconnect: () => ipcRenderer.invoke("serial:disconnect"),
  sendFrame: (frame) => ipcRenderer.invoke("serial:send-frame", frame),
  getStatus: () => ipcRenderer.invoke("serial:status"),

  // PCAN-USB transport (PCANBasic.dll via koffi, see src/main/pcanManager.js).
  // Frames/status/errors arrive on the same onData/onStatus/onError/onDebug
  // listeners below regardless of which transport is active.
  pcanListChannels: () => ipcRenderer.invoke("pcan:list-channels"),
  pcanListBaudRates: () => ipcRenderer.invoke("pcan:list-baud-rates"),
  pcanConnect: (channelId, baudKbps) => ipcRenderer.invoke("pcan:connect", { channelId, baudKbps }),
  pcanDisconnect: () => ipcRenderer.invoke("pcan:disconnect"),

  onPortsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("serial:ports-changed", listener);
    return () => ipcRenderer.removeListener("serial:ports-changed", listener);
  },
  onData: (callback) => {
    const listener = (_evt, frame) => callback(frame);
    ipcRenderer.on("serial:data", listener);
    return () => ipcRenderer.removeListener("serial:data", listener);
  },
  // Structured TX echo (mirrors onData's shape) for the raw monitor page -
  // fires only after a successful write, on whichever transport is active.
  onTxFrame: (callback) => {
    const listener = (_evt, frame) => callback(frame);
    ipcRenderer.on("serial:tx-frame", listener);
    return () => ipcRenderer.removeListener("serial:tx-frame", listener);
  },
  onStatus: (callback) => {
    const listener = (_evt, status) => callback(status);
    ipcRenderer.on("serial:status", listener);
    return () => ipcRenderer.removeListener("serial:status", listener);
  },
  onError: (callback) => {
    const listener = (_evt, message) => callback(message);
    ipcRenderer.on("serial:error", listener);
    return () => ipcRenderer.removeListener("serial:error", listener);
  },
  onDebug: (callback) => {
    const listener = (_evt, message) => callback(message);
    ipcRenderer.on("serial:debug", listener);
    return () => ipcRenderer.removeListener("serial:debug", listener);
  },

  // Frame logging (Start/Stop Logging on the Live CAN Grid page). The
  // renderer has no filesystem access itself - main owns the actual file via
  // frameLogger.js, driven through these calls. `format` is "csv" or "txt"
  // (txt is saved with the ".aeidth.log" extension, see frameLogger.js).
  logChooseFile: (format) => ipcRenderer.invoke("log:choose-file", format),
  logStart: (filePath, format) => ipcRenderer.invoke("log:start", { filePath, format }),
  logStop: () => ipcRenderer.invoke("log:stop"),
  logAppend: (row) => ipcRenderer.invoke("log:append", row),
  logStatus: () => ipcRenderer.invoke("log:status"),
  onLogError: (callback) => {
    const listener = (_evt, message) => callback(message);
    ipcRenderer.on("log:error", listener);
    return () => ipcRenderer.removeListener("log:error", listener);
  },

  // Login against the aeidthocpp BMS backend (see main/authManager.js). The
  // renderer never talks to the network directly - main makes the HTTPS call
  // and hands back { success, token, user, error }.
  login: (email, password) => ipcRenderer.invoke("auth:login", { email, password }),
});
