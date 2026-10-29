# CAN Data Viewer Pro

A standalone Electron + React desktop app for BMS/RBMS CAN diagnostics and
configuration over a serial (Aeidth CAN Tool) connection. Built as a clean,
from-scratch UI on top of the CAN protocol used by the legacy Aeidth CAN
Viewer app, with BMS and RBMS given fully separate page trees, navigation,
and visual identity instead of sharing cramped tabs.

This project is fully independent of the legacy app
(`can-data-viewer/`) — no files there were modified, and this app does not
share any code, config, or build output with it.

## Running it

```bash
npm install
npm start          # builds the renderer once, then launches Electron
```

For active development with hot reload:

```bash
npm run dev         # runs the Vite dev server + Electron together
```

Other scripts:

- `npm run build:renderer` — build the React app to `dist/` only.
- `npm run dist` — package a Windows installer via electron-builder (output in `release/`).

Requires Node.js with native module build tools available, since `serialport`
compiles a native addon on install (same requirement as the legacy app).

## Project structure

```
src/
  main/
    main.js            Electron main process: window, lifecycle, IPC handlers
    preload.js          contextBridge-based safe API surface exposed to the renderer
    serialManager.js    Owns the SerialPort instance, frames incoming data into 21-byte packets
  shared/
    protocol.js          Single source of truth for CAN IDs, CRC16, command framing,
                          and the BMS/RBMS configuration struct layout
  renderer/
    src/
      App.jsx             Top-level shell: device-type picker -> BMS or RBMS route tree
      components/         Sidebar, PageHeader/StatTile, LiveChart, StatusBadge, toast
      hooks/               useSerialConnection, useCanLiveData (live telemetry decoding)
      lib/                 canCommands (frame senders), canDecoder, firmwareUpdate, RBMS protocol state machine
      pages/bms/          Dashboard, Configuration (Cell/Pack/Temperature/PDU/Other), Control Center, Warnings, Parallel, Firmware
      pages/rbms/         Dashboard, Configuration, Command Center, Firmware
```

## Design

- **No login/licensing.** The legacy app's auth flow (POST /loginwithpassword,
  version check, device footprint audit log, role-based restrictions) is
  backend/account infrastructure unrelated to CAN diagnostics, so this app
  skips straight to the connection screen on launch.
- **BMS vs RBMS separation.** Picking a device type routes into a completely
  separate page tree with its own sidebar, colour accent (blue for BMS,
  purple/amber for RBMS), and only the fields relevant to that device type —
  rather than one shared set of tabs with mixed fields.
- **Security.** The renderer has `nodeIntegration: false` and
  `contextIsolation: true`; all serial I/O happens in the main process and is
  reached only through the narrow `window.canApi` bridge in `preload.js`.
- **Protocol fidelity.** CRC16, command framing, CAN IDs, and the BMS
  configuration struct's field order/widths were read directly from the
  legacy app's source (`renderer.js`, `pCanProcesses.js`, `newConfig.js`,
  `configuration.js`), not reimplemented from guesswork. This includes the
  fix where BMS config-fetch must send command byte `0x6d` (RBMS uses
  `0x44`).

## Known differences / assumptions to verify against real hardware

- **RBMS live telemetry.** The legacy app's live CAN ID router
  (`dataOperation()`) has no device-type branch for the heartbeat/cell/temp
  IDs — only the configuration-fetch command byte differs between BMS and
  RBMS. This app assumes RBMS live telemetry uses the same CAN IDs and byte
  layout as BMS. If RBMS hardware actually reports different CAN IDs for live
  data, `useCanLiveData.js` and `shared/protocol.js`'s `CAN_ID` map will need
  RBMS-specific IDs added.
- **Config struct length.** The legacy app accumulates exactly 161 bytes
  before treating a BMS config response as complete, but only 160 bytes are
  ever read out of it by field parsing — the 161st byte is unused padding.
  This app's `CONFIG_FIELDS` layout totals 160 bytes and `decodeConfigArray`
  only consumes the first 160 bytes of whatever buffer it's given, matching
  that behaviour.
- **RBMS configuration struct.** RBMS config fields/layout are ported from
  `RBMSConfig.js` / `RBMSConfigClean.js`'s multi-packet fetch state machine
  (fetch timeout, packet reassembly) faithfully, but RBMS hardware was not
  available to validate a real fetch round-trip end-to-end.
- **Firmware update.** Only the local serial-based flashing mechanics were
  ported (packet building/sending over the connected port). Any
  backend-dependent parts of the legacy firmware flow (e.g. downloading
  firmware images from a server) were intentionally left out, since this app
  has no backend.
- No physical BMS/RBMS hardware was connected during development, so serial
  port listing/connect and CAN frame building were verified in isolation
  (unit-level logic and app boot), but a full live round-trip against real
  hardware has not been exercised. Please validate the config fetch/write
  flow and live dashboard against real hardware before relying on it.
- **CAN Bus Baud Rate is opt-in, not automatic.** The legacy app's CAN baud
  dropdown starts unselected, and most users never touch it — the device
  already runs at its configured bus speed. An earlier version of this app
  sent `setBaudRate()` automatically on every connect (defaulting to 500
  kbps), which was confirmed on real hardware to interfere with the
  login/config-fetch handshake immediately afterward. This is now opt-in only
  (sent when the user explicitly picks a value from the dropdown), matching
  the legacy app's actual behavior.
