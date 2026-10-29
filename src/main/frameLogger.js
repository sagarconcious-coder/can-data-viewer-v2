const { dialog } = require("electron");
const fs = require("fs");
const path = require("path");

/**
 * Owns writing captured CAN frames to a file on disk, driven by the
 * "Start Logging"/"Stop Logging" controls on the Live CAN Grid page.
 * Supports two formats, chosen when the file is picked:
 *  - "csv": comma-separated, one row per frame, .csv extension.
 *  - "txt": human-readable fixed-width text, one line per frame, saved with
 *    this app's own ".aeidth.log" extension rather than plain ".txt" (still
 *    ordinary UTF-8 text underneath - it's just a distinguishing filename,
 *    not a different encoding) so a CAN log from this app is recognizable at
 *    a glance among other files.
 *
 * The renderer never touches the filesystem directly (no Node integration
 * there, by design - see main.js's webPreferences) - it sends already-
 * formatted row objects over IPC and this owns the actual file handle,
 * exactly like SerialManager/PcanManager own the actual transport.
 */
const TXT_SUFFIX = ".aeidth.log";

class FrameLogger extends require("events").EventEmitter {
  constructor() {
    super();
    this.filePath = null; // last-used path, remembered even while stopped so "Start" again can offer to reuse it
    this.format = "csv"; // format of that last-used path, so a reuse doesn't guess wrong
    this.stream = null;
    this.logging = false;
  }

  /**
   * Opens the native "Save As" dialog for the given format ("csv" or "txt").
   * Returns the chosen path, or null if cancelled. For "txt", the dialog's
   * own extension filter offers ".aeidth.log" - if the user instead types a
   * bare name with no recognized extension, one is appended so the file
   * always ends up correctly suffixed regardless of what the OS dialog
   * returns (Windows/macOS save dialogs handle a single trailing extension
   * naturally; a compound one like ".aeidth.log" isn't always preserved the
   * same way, so it's normalized here rather than trusted blindly).
   */
  async chooseFile(window, format) {
    const isTxt = format === "txt";
    const defaultBase = this.filePath ? stripKnownExtension(this.filePath) : "can-log";
    const result = await dialog.showSaveDialog(window, {
      title: "Save CAN Log As",
      defaultPath: isTxt ? `${defaultBase}${TXT_SUFFIX}` : `${defaultBase}.csv`,
      filters: isTxt
        ? [
            { name: "Aeidth Log", extensions: ["aeidth.log"] },
            { name: "All Files", extensions: ["*"] },
          ]
        : [
            { name: "CSV Log", extensions: ["csv"] },
            { name: "All Files", extensions: ["*"] },
          ],
    });
    if (result.canceled || !result.filePath) return null;
    return normalizeExtension(result.filePath, format);
  }

  /**
   * Starts logging to `filePath` in `format` ("csv" | "txt") - truncates/
   * creates it fresh ("start a new log" is the expected meaning of Start
   * Logging, not silently appending to whatever was there from an unrelated
   * earlier session). Writes a header line immediately so even a session
   * with zero frames leaves a valid, openable file.
   */
  start(filePath, format) {
    if (this.stream) this._closeStream();
    const fmt = format === "txt" ? "txt" : "csv";
    try {
      this.stream = fs.createWriteStream(filePath, { flags: "w" });
      this.stream.on("error", (err) => {
        this.emit("error", `Log write failed: ${err.message}`);
        this.logging = false;
        this.filePath = null;
        this.stream = null;
      });
      this.stream.write(fmt === "csv" ? csvHeader() : txtHeader());
      this.filePath = filePath;
      this.format = fmt;
      this.logging = true;
      return { success: true, filePath, format: fmt };
    } catch (err) {
      this.emit("error", `Could not open log file: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /** Appends one already-formatted row in whichever format logging was started with. Silently no-ops if not currently logging (cheap to call unconditionally from the frame stream). */
  appendRow(row) {
    if (!this.logging || !this.stream) return;
    this.stream.write(this.format === "csv" ? csvLine(row) : txtLine(row));
  }

  stop() {
    this.logging = false;
    this._closeStream();
    return { success: true, filePath: this.filePath };
  }

  _closeStream() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  getStatus() {
    return { logging: this.logging, filePath: this.filePath, format: this.format };
  }
}

function stripKnownExtension(filePath) {
  const dir = path.dirname(filePath);
  let base = path.basename(filePath);
  if (base.toLowerCase().endsWith(TXT_SUFFIX)) base = base.slice(0, -TXT_SUFFIX.length);
  else base = base.replace(/\.[^./\\]+$/, "");
  return dir === "." ? base : path.join(dir, base);
}

function normalizeExtension(filePath, format) {
  if (format === "txt") {
    if (filePath.toLowerCase().endsWith(TXT_SUFFIX)) return filePath;
    // The Save dialog may hand back "name.aeidth" (compound extensions get
    // split oddly by some OS pickers) or a bare "name" with no extension at
    // all - either way, force the exact ".aeidth.log" suffix.
    const withoutTrailingExt = filePath.replace(/\.[^./\\]+$/, "");
    return `${withoutTrailingExt}${TXT_SUFFIX}`;
  }
  return filePath.toLowerCase().endsWith(".csv") ? filePath : `${filePath}.csv`;
}

function csvHeader() {
  return "Timestamp,Direction,CAN ID,ID Type,Message,DLC,Data Bytes\n";
}

function csvLine(row) {
  const fields = [row.timestamp, row.direction, row.idHex, row.idType, row.name || "", String(row.dlc), row.dataHex].map(
    csvEscape,
  );
  return fields.join(",") + "\n";
}

function csvEscape(value) {
  const str = String(value ?? "");
  // Quote whenever the field could otherwise be misread: contains the
  // delimiter, a quote character (needing escaping), or a line break.
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function txtHeader() {
  return (
    "# Aeidth CAN Log\n" +
    "# " +
    "Timestamp".padEnd(13) +
    "Dir".padEnd(5) +
    "CAN ID".padEnd(13) +
    "Type".padEnd(10) +
    "Message".padEnd(24) +
    "DLC".padEnd(5) +
    "Data Bytes\n"
  );
}

function txtLine(row) {
  // Fixed-width columns, human-readable at a glance (same spirit as a
  // BUSMASTER/candump-style plaintext trace) rather than needing a
  // spreadsheet to read. Timestamp is trimmed to HH:MM:SS.mmm (the ISO
  // string's date portion is redundant noise for a live capture session).
  const time = (row.timestamp.split("T")[1] || row.timestamp).replace("Z", "");
  return (
    time.padEnd(13) +
    row.direction.padEnd(5) +
    row.idHex.padEnd(13) +
    row.idType.padEnd(10) +
    (row.name || "-").padEnd(24) +
    String(row.dlc).padEnd(5) +
    row.dataHex +
    "\n"
  );
}

module.exports = { FrameLogger };
