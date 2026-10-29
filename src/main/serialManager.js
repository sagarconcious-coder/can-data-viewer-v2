const { SerialPort } = require("serialport");
const { EventEmitter } = require("events");

/**
 * Owns the single active serial connection in the main process.
 *
 * Packet framing matches the legacy app (js/renderer.js readData()): raw bytes
 * are accumulated and sliced into fixed 21-byte CAN frames
 * ([0x2A,0x26,0x24,messageId,canId0..3,dataLen,data0..7,crcLo,crcHi,0x0D,0x0A]).
 */
class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.buffer = Buffer.alloc(0);
    this.isOpen = false;
    this.currentPath = null;
    this.currentBaud = null;
  }

  async listPorts() {
    try {
      const ports = await SerialPort.list();
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer || "",
        serialNumber: p.serialNumber || "",
        vendorId: p.vendorId || "",
        productId: p.productId || "",
        friendlyName: p.friendlyName || p.path,
      }));
    } catch (err) {
      this.emit("error", `Failed to list serial ports: ${err.message}`);
      return [];
    }
  }

  async connect(portPath, baudRate) {
    if (this.port && this.isOpen) {
      await this.disconnect();
    }

    return new Promise((resolve) => {
      try {
        this.port = new SerialPort({ path: portPath, baudRate: Number(baudRate) || 115200 }, (err) => {
          if (err) {
            this.emit("error", `Could not open ${portPath}: ${err.message}`);
            resolve({ success: false, error: err.message });
            return;
          }
        });
      } catch (err) {
        this.emit("error", `Could not open ${portPath}: ${err.message}`);
        resolve({ success: false, error: err.message });
        return;
      }

      this.port.on("open", () => {
        this.isOpen = true;
        this.currentPath = portPath;
        this.currentBaud = baudRate;
        this.emit("status", { connected: true, path: portPath, baudRate });
        resolve({ success: true });
      });

      this.port.on("data", (chunk) => {
        this.emit("debug", `RX ${chunk.length} bytes: ${chunk.toString("hex")}`);
        this.buffer = Buffer.concat([this.buffer, chunk]);
        // Frames are 21 bytes starting with 0x2A 0x26 0x24. The legacy app
        // slices at fixed 21-byte boundaries with no resync, which means a
        // single dropped/duplicated/extra byte anywhere on the wire (a real
        // possibility on serial links, especially during a burst like a
        // multi-packet config-fetch response) permanently desyncs every frame
        // after it for the rest of the session: CAN IDs decode as garbage,
        // the desired response never matches, and the fetch silently times
        // out even though data was in fact arriving. Resync on the frame
        // header instead of trusting byte-count alignment so a single
        // corrupted byte only costs one frame, not the whole session.
        while (this.buffer.length >= 21) {
          if (this.buffer[0] !== 0x2a || this.buffer[1] !== 0x26 || this.buffer[2] !== 0x24) {
            const nextStart = this.buffer.indexOf(Buffer.from([0x2a, 0x26, 0x24]), 1);
            if (nextStart === -1) {
              this.emit("debug", "resync: no frame header found, discarding buffer");
              this.buffer = Buffer.alloc(0);
              break;
            }
            this.emit("debug", `resync: discarding ${nextStart} leading byte(s) before next frame header`);
            this.buffer = this.buffer.subarray(nextStart);
            continue;
          }
          const packet = this.buffer.subarray(0, 21);
          this.buffer = this.buffer.subarray(21);
          // The legacy 21-byte wire protocol has no standard/extended (11-bit
          // vs 29-bit) indicator bit anywhere in it - unlike PCAN-Basic,
          // which reports this per-frame from real hardware (see
          // pcanManager.js's MSGTYPE handling). The only thing we can go on
          // here is the arbitration id's magnitude: nothing above 0x7FF fits
          // in an 11-bit standard id, so an id larger than that must be
          // extended. Appended as a 22nd byte so every existing consumer that
          // only reads frame[0..20] (CRC, decoders, the fixed 21-byte
          // framing itself) is unaffected.
          const canId = (packet[7] << 24) | (packet[6] << 16) | (packet[5] << 8) | packet[4];
          const frameType = (canId >>> 0) > 0x7ff ? 1 : 0; // 0 = standard, 1 = extended
          this.emit("data", [...Array.from(packet), frameType]);
        }
      });

      this.port.on("close", () => {
        this.isOpen = false;
        this.emit("status", { connected: false, path: this.currentPath, baudRate: this.currentBaud });
      });

      this.port.on("error", (err) => {
        this.emit("error", err.message);
      });
    });
  }

  async disconnect() {
    return new Promise((resolve) => {
      if (this.port && this.port.isOpen) {
        this.port.close(() => {
          this.isOpen = false;
          this.buffer = Buffer.alloc(0);
          resolve({ success: true });
        });
      } else {
        this.isOpen = false;
        resolve({ success: true });
      }
    });
  }

  async sendFrame(frameArray) {
    if (!this.port || !this.port.isOpen) {
      this.emit("debug", "sendFrame called but port is not open");
      return { success: false, error: "Serial port not open" };
    }
    // The wire protocol is a fixed 21 bytes with no type indicator (see the
    // RX-side comment in the "data" handler above) - a 22nd byte some
    // callers now append for their own bookkeeping (Transmit panel frame
    // type) must never actually go out on the wire, or it desyncs the
    // device's next frame read. Only the first 21 bytes are ever written;
    // the full array (with any 22nd byte) is still echoed to the renderer
    // below.
    const buf = Buffer.from(frameArray.slice(0, 21));
    this.emit("debug", `TX ${buf.length} bytes: ${buf.toString("hex")}`);
    return new Promise((resolve) => {
      this.port.write(buf, (err) => {
        if (err) {
          this.emit("error", `Write failed: ${err.message}`);
          resolve({ success: false, error: err.message });
        } else {
          this.port.drain((drainErr) => {
            if (drainErr) {
              this.emit("debug", `drain error: ${drainErr.message}`);
            }
            // Structured TX echo for the raw monitor page (Raw Monitor /
            // canRawFrameLog), same 21-byte legacy shape as "data" (RX) so the
            // renderer can decode both sides with one code path. "debug" above
            // only carries a hex-dump string, not something a table can render
            // as ID/DLC/data columns. Carries the caller's explicit frame-type
            // byte through if it supplied one (Transmit panel), else infers
            // it from the id the same way RX does, so Tx rows in the UI get
            // a Standard/Extended label exactly like Rx rows do.
            const canId = (buf[7] << 24) | (buf[6] << 16) | (buf[5] << 8) | buf[4];
            const frameType =
              frameArray.length > 21 ? frameArray[21] : (canId >>> 0) > 0x7ff ? 1 : 0;
            this.emit("tx-frame", [...Array.from(buf), frameType]);
            resolve({ success: true });
          });
        }
      });
    });
  }

  getStatus() {
    return {
      connected: this.isOpen,
      path: this.currentPath,
      baudRate: this.currentBaud,
    };
  }
}

module.exports = { SerialManager };
