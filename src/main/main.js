const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { SerialManager } = require("./serialManager");
const { PcanManager } = require("./pcanManager");
const { FrameLogger } = require("./frameLogger");
const { AuthManager } = require("./authManager");

let mainWindow = null;
const serialManager = new SerialManager();
const pcanManager = new PcanManager();
const frameLogger = new FrameLogger();
const authManager = new AuthManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0f17",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }

  if (process.env.CDV_DEBUG_CONSOLE) {
    // Opt-in renderer console mirroring for local debugging: run with
    // CDV_DEBUG_CONSOLE=1 npm start to see renderer console.* output in this
    // terminal (useful since DevTools aren't always convenient headlessly).
    mainWindow.webContents.on("console-message", (e, level, message, line, sourceId) => {
      console.log("[renderer]", message, `(${sourceId}:${line})`);
    });
  }

  // Forward serial events to renderer
  serialManager.on("ports-changed", () => {
    if (mainWindow) mainWindow.webContents.send("serial:ports-changed");
  });
  serialManager.on("data", (frame) => {
    if (mainWindow) mainWindow.webContents.send("serial:data", frame);
  });
  serialManager.on("tx-frame", (frame) => {
    if (mainWindow) mainWindow.webContents.send("serial:tx-frame", frame);
  });
  serialManager.on("status", (status) => {
    if (mainWindow) mainWindow.webContents.send("serial:status", status);
  });
  serialManager.on("error", (message) => {
    if (mainWindow) mainWindow.webContents.send("serial:error", message);
  });
  serialManager.on("debug", (message) => {
    if (mainWindow) mainWindow.webContents.send("serial:debug", message);
  });

  // Forward PCAN events to renderer, on the same channel names as serial so
  // the renderer side (useSerialConnection/useCanLiveData) doesn't need to
  // know which transport is active - see preload.js.
  pcanManager.on("data", (frame) => {
    if (mainWindow) mainWindow.webContents.send("serial:data", frame);
  });
  pcanManager.on("tx-frame", (frame) => {
    if (mainWindow) mainWindow.webContents.send("serial:tx-frame", frame);
  });
  pcanManager.on("status", (status) => {
    if (mainWindow) mainWindow.webContents.send("serial:status", status);
  });
  pcanManager.on("error", (message) => {
    if (mainWindow) mainWindow.webContents.send("serial:error", message);
  });
  pcanManager.on("debug", (message) => {
    if (mainWindow) mainWindow.webContents.send("serial:debug", message);
  });

  frameLogger.on("error", (message) => {
    if (mainWindow) mainWindow.webContents.send("log:error", message);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  serialManager.disconnect().catch(() => {});
  pcanManager.disconnect().catch(() => {});
  frameLogger.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serialManager.disconnect().catch(() => {});
  pcanManager.disconnect().catch(() => {});
  frameLogger.stop();
});

// ─── IPC handlers ──────────────────────────────────────────────────────────
// Two transports can back the same CAN link: a serial (RS485/Aeidth CAN
// Tool) connection, or a PCAN-USB adapter via PCANBasic.dll. Only one is
// ever active at a time - `activeTransport` tracks which, so send-frame can
// be routed correctly regardless of which the renderer connected through.
let activeTransport = "serial";

ipcMain.handle("serial:list-ports", async () => {
  return serialManager.listPorts();
});

ipcMain.handle("serial:connect", async (_evt, { path: portPath, baudRate }) => {
  await pcanManager.disconnect().catch(() => {});
  const result = await serialManager.connect(portPath, baudRate);
  if (result.success) activeTransport = "serial";
  return result;
});

ipcMain.handle("serial:disconnect", async () => {
  return serialManager.disconnect();
});

ipcMain.handle("serial:send-frame", async (_evt, frame) => {
  return activeTransport === "pcan" ? pcanManager.sendFrame(frame) : serialManager.sendFrame(frame);
});

ipcMain.handle("serial:status", async () => {
  return activeTransport === "pcan" ? pcanManager.getStatus() : serialManager.getStatus();
});

// ─── PCAN IPC handlers ─────────────────────────────────────────────────────
ipcMain.handle("pcan:list-channels", async () => {
  return pcanManager.listChannels();
});

ipcMain.handle("pcan:list-baud-rates", async () => {
  return pcanManager.listBaudRates();
});

ipcMain.handle("pcan:connect", async (_evt, { channelId, baudKbps }) => {
  await serialManager.disconnect().catch(() => {});
  const result = await pcanManager.connect(channelId, baudKbps);
  if (result.success) activeTransport = "pcan";
  return result;
});

ipcMain.handle("pcan:disconnect", async () => {
  return pcanManager.disconnect();
});

// ─── Frame logging IPC handlers ───────────────────────────────────────────
// The renderer has no filesystem access (nodeIntegration: false) - it sends
// already-formatted row objects here to be appended, and asks this side to
// drive the native Save dialog. See frameLogger.js.
ipcMain.handle("log:choose-file", async (_evt, format) => {
  return frameLogger.chooseFile(mainWindow, format);
});

ipcMain.handle("log:start", async (_evt, { filePath, format }) => {
  return frameLogger.start(filePath, format);
});

ipcMain.handle("log:stop", async () => {
  return frameLogger.stop();
});

ipcMain.handle("log:append", async (_evt, row) => {
  frameLogger.appendRow(row);
  return { success: true };
});

ipcMain.handle("log:status", async () => {
  return frameLogger.getStatus();
});

// ─── Auth IPC handler ──────────────────────────────────────────────────────
// Renderer has no network access itself - the actual HTTPS call to
// aeidthocpp lives in authManager.js, same rationale as the other managers.
ipcMain.handle("auth:login", async (_evt, { email, password }) => {
  return authManager.login(email, password);
});
