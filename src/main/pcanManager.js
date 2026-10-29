const koffi = require("koffi");
const { EventEmitter } = require("events");

/**
 * Owns the single active PCAN-Basic connection in the main process.
 *
 * This replaces the legacy app's approach (js/pCanProcesses.js), which
 * shelled out to an external "C:/CAN1.3.exe" and talked to it over
 * stdin/stdout text lines. PCAN-Basic ships its own driver DLL
 * (PCANBasic.dll, installed alongside the PEAK PCAN-USB drivers) - we call
 * it directly via FFI instead, so no external executable is required.
 *
 * To keep the renderer/IPC surface, canDecoder.js, canCommands.js and
 * useCanLiveData.js completely transport-agnostic, PCAN frames are
 * translated to/from the same 21-byte legacy frame shape used by the serial
 * path: [0x2A,0x26,0x24, messageId, canId0..3, dataLen=8, data0..7,
 * crcLo, crcHi, 0x0D, 0x0A]. Only the CAN id (bytes 4-7, little-endian) and
 * the 8 data bytes (bytes 9-16) are ever read on the way in, and only those
 * are meaningful on the way out - messageId/CRC/trailer are ignored by real
 * PCAN hardware, so we fill placeholder values when unwrapping outbound
 * frames and reconstruct a compatible wrapper around inbound ones.
 */

// ── PCAN-Basic type/value definitions (subset, from PCANBasic.py) ──────────
const PCAN_USBBUS1 = 0x51;
const PCAN_USBBUS_BY_INDEX = (n) => 0x50 + n; // PCAN_USBBUS1..16 are 0x51..0x62 (contiguous)

const PCAN_ERROR_OK = 0x00000;

// TPCANBaudrate values (PCAN_BAUD_*)
const BAUD_RATES = {
  1000: 0x0014, // PCAN_BAUD_1M
  800: 0x0016, // PCAN_BAUD_800K
  500: 0x001c, // PCAN_BAUD_500K
  250: 0x011c, // PCAN_BAUD_250K
  125: 0x031a, // PCAN_BAUD_125K
  100: 0x432f, // PCAN_BAUD_100K
  95: 0xc34e, // PCAN_BAUD_95K
  83: 0x852b, // PCAN_BAUD_83K
  50: 0x472f, // PCAN_BAUD_50K
  47: 0x1414, // PCAN_BAUD_47K
  33: 0x8b2f, // PCAN_BAUD_33K
  20: 0x532f, // PCAN_BAUD_20K
  10: 0x672f, // PCAN_BAUD_10K
  5: 0x7f7f, // PCAN_BAUD_5K
};

const PCAN_MESSAGE_STANDARD = 0x00;
// Every CAN ID this protocol uses (LOGIN_TX, CMD_TX, CONFIG_ARRAY, etc. - see
// shared/protocol.js and the DBC) is a 29-bit extended ID: e.g. LOGIN_TX
// 512496471 = 0x1E8C1357, which doesn't fit in an 11-bit standard frame at
// all. The DBC file confirms this - its BO_ message IDs have the top bit
// (0x80000000) set, which is the DBC convention marking an extended ID.
// TX frames must be written with PCAN_MESSAGE_EXTENDED or the driver either
// truncates/rejects the ID or the device never recognizes it, so it never
// replies - which silently manifests as every fetch/command timing out.
const PCAN_MESSAGE_EXTENDED = 0x02;

class PcanManager extends EventEmitter {
  constructor() {
    super();
    this.lib = null;
    this.CAN_Initialize = null;
    this.CAN_Uninitialize = null;
    this.CAN_Read = null;
    this.CAN_Write = null;
    this.CAN_GetErrorText = null;

    this.channel = null;
    this.isOpen = false;
    this.pollTimer = null;
    this.currentChannelLabel = null;
    this.currentBaud = null;
  }

  /** Lazily loads PCANBasic.dll. Throws with a clear message if not installed. */
  _ensureLib() {
    if (this.lib) return;
    try {
      this.lib = koffi.load("PCANBasic.dll");
    } catch (err) {
      throw new Error(
        "PCANBasic.dll not found. Install the PEAK PCAN-Basic driver package " +
          "(the same driver your PCAN-USB adapter normally uses) and try again. " +
          `(${err.message})`,
      );
    }

    // TPCANMsg struct: { DWORD ID; BYTE MSGTYPE; BYTE LEN; BYTE DATA[8]; }
    const TPCANMsg = koffi.struct("TPCANMsg", {
      ID: "uint32",
      MSGTYPE: "uint8",
      LEN: "uint8",
      DATA: koffi.array("uint8", 8),
    });

    this.CAN_Initialize = this.lib.func(
      "__stdcall",
      "CAN_Initialize",
      "uint32",
      ["uint16", "uint16", "uint8", "uint32", "uint16"],
    );
    this.CAN_Uninitialize = this.lib.func("__stdcall", "CAN_Uninitialize", "uint32", ["uint16"]);
    this.CAN_Write = this.lib.func("__stdcall", "CAN_Write", "uint32", ["uint16", koffi.pointer(TPCANMsg)]);
    this.CAN_Read = this.lib.func("__stdcall", "CAN_Read", "uint32", [
      "uint16",
      koffi.out(koffi.pointer(TPCANMsg)),
      koffi.pointer("void"), // TPCANTimestamp* - unused, pass null
    ]);
    // Buffer-out parameters are declared as plain pointer types ("char *" /
    // "void *") and satisfied by passing a Node Buffer directly - koffi
    // marshals a Buffer as the backing memory for a pointer arg and lets us
    // read the result back out of it afterwards. koffi.out(koffi.pointer(...))
    // is for scalar out-params, not fixed-size buffers, and errors here.
    this.CAN_GetErrorText = this.lib.func("__stdcall", "CAN_GetErrorText", "uint32", [
      "uint32",
      "uint16",
      "char *",
    ]);
    this.CAN_GetValue = this.lib.func("__stdcall", "CAN_GetValue", "uint32", [
      "uint16",
      "uint8",
      "void *",
      "uint32",
    ]);

    this.TPCANMsg = TPCANMsg;
  }

  _errorText(status) {
    try {
      const buf = Buffer.alloc(256);
      this.CAN_GetErrorText(status, 0x09, buf);
      const nul = buf.indexOf(0);
      return buf.toString("latin1", 0, nul === -1 ? buf.length : nul) || `error 0x${status.toString(16)}`;
    } catch {
      return `error 0x${status.toString(16)}`;
    }
  }

  /**
   * Lists USB channels that PCAN-Basic actually reports hardware present on,
   * using CAN_GetValue(PCAN_CHANNEL_CONDITION) per channel. Earlier this
   * offered all 8 USB channel slots unconditionally regardless of whether an
   * adapter was actually attached to each - PCAN_USBBUS1 is the only one
   * with real hardware behind it in the common single-adapter case, so
   * PCAN_USBBUS2..8 always failed to open with PCAN_ERROR_ILLHW ("hardware
   * handle is invalid") if picked. Filtering by condition here means only
   * channels that can actually succeed are ever shown.
   */
  async listChannels() {
    try {
      this._ensureLib();
    } catch (err) {
      this.emit("debug", `listChannels: ${err.message}`);
      return [];
    }

    // 0x0D, confirmed against PCANBasic.py - an earlier 0x11 here was wrong
    // (that's PCAN_CHANNEL_IDENTIFYING) and made CAN_GetValue return
    // PCAN_ERROR_INITIALIZE for every channel, silently emptying the list.
    const PCAN_CHANNEL_CONDITION = 0x0d;
    const PCAN_CHANNEL_AVAILABLE = 0x01;
    const PCAN_CHANNEL_OCCUPIED = 0x02; // in use by this or another process - still selectable

    const channels = [];
    for (let i = 1; i <= 8; i++) {
      const channelId = PCAN_USBBUS_BY_INDEX(i);
      try {
        const buf = Buffer.alloc(4);
        const status = this.CAN_GetValue(channelId, PCAN_CHANNEL_CONDITION, buf, 4);
        if (status !== PCAN_ERROR_OK) continue;
        const condition = buf.readUInt32LE(0);
        if (condition === PCAN_CHANNEL_AVAILABLE || condition === PCAN_CHANNEL_OCCUPIED) {
          channels.push({
            id: channelId,
            label: condition === PCAN_CHANNEL_OCCUPIED ? `PCAN-USB ${i} (in use)` : `PCAN-USB ${i}`,
          });
        }
      } catch (err) {
        this.emit("debug", `listChannels: channel ${i} query failed: ${err.message}`);
      }
    }
    return channels;
  }

  listBaudRates() {
    return Object.keys(BAUD_RATES)
      .map(Number)
      .sort((a, b) => b - a)
      .map((kbps) => ({ value: kbps, label: `${kbps} kbps` }));
  }

  async connect(channelId, baudKbps) {
    if (this.isOpen) {
      await this.disconnect();
    }

    try {
      this._ensureLib();
    } catch (err) {
      this.emit("error", err.message);
      return { success: false, error: err.message };
    }

    const channel = Number(channelId) || PCAN_USBBUS1;
    const baudCode = BAUD_RATES[Number(baudKbps)] ?? BAUD_RATES[500];

    const status = this.CAN_Initialize(channel, baudCode, 0, 0, 0);
    if (status !== PCAN_ERROR_OK) {
      const message = `Could not open PCAN channel: ${this._errorText(status)}`;
      this.emit("error", message);
      return { success: false, error: message };
    }

    this.channel = channel;
    this.isOpen = true;
    this.currentChannelLabel = `PCAN 0x${channel.toString(16)}`;
    this.currentBaud = baudKbps;
    this.emit("status", { connected: true, path: this.currentChannelLabel, baudRate: `${baudKbps} kbps (CAN)` });

    this._startPolling();
    return { success: true };
  }

  _startPolling() {
    // PCAN-Basic's plain (non-FD) API is poll-based rather than event/callback
    // driven over this binding, so CAN_Read is called on a short interval.
    // 5ms keeps latency low without pegging a CPU core.
    this.pollTimer = setInterval(() => {
      if (!this.isOpen) return;
      try {
        const msgOut = {};
        let status = this.CAN_Read(this.channel, msgOut, null);
        // Drain all pending messages each tick, not just one, so a burst
        // doesn't back up behind the poll interval.
        while (status === PCAN_ERROR_OK) {
          this._handleMessage(msgOut);
          status = this.CAN_Read(this.channel, msgOut, null);
        }
        const PCAN_ERROR_QRCVEMPTY = 0x00020;
        if (status !== PCAN_ERROR_QRCVEMPTY && (status & PCAN_ERROR_QRCVEMPTY) === 0 && status !== PCAN_ERROR_OK) {
          // Anything other than "queue empty" is worth surfacing quietly via
          // debug, but not spamming the user with a toast per poll tick.
          this.emit("debug", `CAN_Read status 0x${status.toString(16)}: ${this._errorText(status)}`);
        }
      } catch (err) {
        this.emit("debug", `poll error: ${err.message}`);
      }
    }, 5);
  }

  _handleMessage(msg) {
    // CAN_Read also surfaces PCAN-internal status/error/echo pseudo-messages
    // (MSGTYPE bits 0x20/0x40/0x80) alongside real data frames - those carry
    // driver diagnostics in the DATA bytes, not device payload, and must not
    // be decoded as one or they'd inject garbage into the live-data/config
    // state. Only plain data frames (standard or extended, no RTR) are
    // forwarded on.
    const PCAN_NON_DATA_MASK = 0x01 | 0x20 | 0x40 | 0x80; // RTR | ECHO | ERRFRAME | STATUS
    if (msg.MSGTYPE & PCAN_NON_DATA_MASK) {
      this.emit("debug", `RX non-data frame, MSGTYPE=0x${msg.MSGTYPE.toString(16)} - ignored`);
      return;
    }

    const id = msg.ID >>> 0;
    const data = msg.DATA || [];
    this.emit("debug", `RX id=0x${id.toString(16)} data=${data.slice(0, msg.LEN).join(",")}`);

    // Wrap into the legacy 21-byte frame shape so the existing decoder
    // (canDecoder.js decodeFrame) works unmodified. messageId/CRC/trailer are
    // not meaningful for a real PCAN frame - filled with placeholders that
    // satisfy the frame's fixed shape without being interpreted as anything.
    const frame = new Array(21).fill(0);
    frame[0] = 0x2a;
    frame[1] = 0x26;
    frame[2] = 0x24;
    frame[3] = 0; // messageId - unused by decodeFrame
    frame[4] = id & 0xff;
    frame[5] = (id >> 8) & 0xff;
    frame[6] = (id >> 16) & 0xff;
    frame[7] = (id >> 24) & 0xff;
    frame[8] = 8;
    for (let i = 0; i < 8; i++) frame[9 + i] = data[i] ?? 0;
    frame[17] = 0;
    frame[18] = 0;
    frame[19] = 0x0d;
    frame[20] = 0x0a;
    // 22nd byte, additive - see the matching comment in serialManager.js.
    // Unlike the serial transport, PCAN-Basic reports this directly from the
    // hardware rather than needing to be inferred from the id's magnitude.
    frame[21] = msg.MSGTYPE & PCAN_MESSAGE_EXTENDED ? 1 : 0; // 0 = standard, 1 = extended

    this.emit("data", frame);
  }

  async disconnect() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.isOpen && this.channel != null) {
      try {
        this.CAN_Uninitialize(this.channel);
      } catch (err) {
        this.emit("debug", `uninitialize error: ${err.message}`);
      }
    }
    const wasOpen = this.isOpen;
    this.isOpen = false;
    if (wasOpen) {
      this.emit("status", { connected: false, path: this.currentChannelLabel, baudRate: this.currentBaud });
    }
    this.channel = null;
    return { success: true };
  }

  /**
   * Accepts the same 21-byte legacy frame array canCommands.js already
   * builds for the serial path, unwraps the CAN id + 8 data bytes, and
   * writes a real TPCANMsg over the DLL.
   */
  async sendFrame(frameArray) {
    if (!this.isOpen) {
      this.emit("debug", "sendFrame called but PCAN channel is not open");
      return { success: false, error: "PCAN channel not open" };
    }
    if (!Array.isArray(frameArray) || frameArray.length < 17) {
      return { success: false, error: "Malformed frame" };
    }

    const id = (frameArray[7] << 24) | (frameArray[6] << 16) | (frameArray[5] << 8) | frameArray[4];
    const data = frameArray.slice(9, 17);

    // Optional 22nd byte (0 = standard/11-bit, 1 = extended/29-bit), set by
    // the Transmit panel when the user explicitly picks a frame type - see
    // the matching RX comment above. Every existing caller (canCommands.js's
    // sendCommand, used throughout the BMS/RBMS dashboards) only ever builds
    // 21-byte frames and this app's own protocol IDs are all 29-bit, so
    // defaulting to extended when the byte is absent preserves current
    // behavior for all of them unchanged.
    const explicitType = frameArray.length > 21 ? frameArray[21] : null;
    const msgType = explicitType === 0 ? PCAN_MESSAGE_STANDARD : PCAN_MESSAGE_EXTENDED;

    const msg = {
      ID: id >>> 0,
      MSGTYPE: msgType,
      LEN: 8,
      DATA: data,
    };

    this.emit("debug", `TX id=0x${(id >>> 0).toString(16)} data=${data.join(",")}`);

    try {
      const status = this.CAN_Write(this.channel, msg);
      if (status !== PCAN_ERROR_OK) {
        const message = `Write failed: ${this._errorText(status)}`;
        this.emit("error", message);
        return { success: false, error: message };
      }
      // Structured TX echo for the raw monitor page - same legacy frame shape
      // as "data" (RX), see the matching comment in serialManager.sendFrame().
      // Always includes the frame-type byte (defaulting to extended, same as
      // msgType above) so Tx rows get a Standard/Extended label exactly like
      // Rx rows do, whether or not the caller supplied one explicitly.
      const txFrame = frameArray.length > 21 ? frameArray : [...frameArray, msgType === PCAN_MESSAGE_STANDARD ? 0 : 1];
      this.emit("tx-frame", txFrame);
      return { success: true };
    } catch (err) {
      this.emit("error", `Write failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  getStatus() {
    return {
      connected: this.isOpen,
      path: this.currentChannelLabel,
      baudRate: this.currentBaud,
    };
  }
}

module.exports = { PcanManager };
