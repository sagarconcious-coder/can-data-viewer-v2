/**
 * Unwraps a 21-byte legacy frame ([0x2A,0x26,0x24,messageId,canId0..3,
 * dataLen,data0..7,crcLo,crcHi,0x0D,0x0A] - see serialManager.js/pcanManager.js)
 * into a plain CAN id + data + type row. Both the serial/RS485 transport and
 * the PEAK CAN transport emit this exact shape (pcanManager.js wraps real
 * PCAN frames into it on the way in), so this one function reads raw traffic
 * from either tool with no transport-specific branching.
 *
 * Both managers additionally append an optional 22nd byte: 0 = standard
 * (11-bit) id, 1 = extended (29-bit) id. PCAN reports this from real
 * hardware; the serial transport (which has no such bit on the wire) infers
 * it from the id's magnitude. Older/malformed 21-byte-only frames fall back
 * to the same inference here.
 *
 * Deliberately does NOT resolve a message name from this app's built-in
 * protocol.CAN_ID table (canIdNames.js) - a name shown here should only ever
 * mean "a loaded DBC recognizes this id", never "this app happens to also
 * use this id for its own BMS/RBMS protocol", which was confusing to see
 * with no DBC loaded at all. RawMonitor.jsx/LiveMonitor.jsx are the only
 * places a name gets attached, purely from dbc.messages.get(id).
 *
 * Shared by useRawFrameLog, useLiveCanGrid, and useFrameLogging so all three
 * agree on exactly what a "row" looks like from the same raw frame.
 */
export function unwrapCanFrame(frame) {
  if (!Array.isArray(frame) || frame.length < 17) return null;
  const id = ((frame[7] << 24) | (frame[6] << 16) | (frame[5] << 8) | frame[4]) >>> 0;
  const dlc = frame[8] ?? 8;
  const data = frame.slice(9, 9 + Math.min(dlc, 8));
  const isExtended = frame.length > 21 ? frame[21] === 1 : id > 0x7ff;
  return {
    id,
    idHex: `0x${id.toString(16).toUpperCase().padStart(8, "0")}`,
    idType: isExtended ? "Extended" : "Standard",
    dlc,
    data,
  };
}
