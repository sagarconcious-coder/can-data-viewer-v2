/**
 * Minimal Vector DBC parser: reads BO_ (message) and SG_ (signal) lines only.
 * No CM_ (comments), VAL_ (value tables/enums), or BA_ (attributes) support -
 * this project's own DBC_File_Update_11.11_RBMS_HV.dbc doesn't use any of
 * those, and the Raw Monitor only needs message names + physical signal
 * values, not descriptions or enum labels. Extend here if a future DBC needs
 * more.
 *
 * DBC line shapes handled:
 *   BO_ <id> <MessageName>: <dlc> <sender>
 *    SG_ <SignalName> : <startBit>|<length>@<byteOrder><signed> (<factor>,<offset>) [<min>|<max>] "<unit>" <receiver>
 *
 * byteOrder: 0 = big-endian/Motorola (start bit counts from MSB, "@0"),
 *            1 = little-endian/Intel (start bit counts from LSB, "@1").
 * signed: "+" = unsigned, "-" = signed (two's complement).
 */

const BO_RE = /^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\S+)/;
const SG_RE =
  /^SG_\s+(\w+)\s*(?:m\d+)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(([^,]+),([^)]+)\)\s*\[([^|]*)\|([^\]]*)\]\s*"([^"]*)"\s*(.*)$/;

// DBC convention (also noted in pcanManager.js): an extended 29-bit CAN id is
// stored with bit 31 (0x80000000) set to distinguish it from an 11-bit
// standard id sharing the same low bits. Frames captured off the wire never
// have that bit set (SerialManager/PcanManager both hand back the raw
// arbitration id), so message ids must be masked the same way before they
// can be matched against a live frame's id.
const EXTENDED_ID_FLAG = 0x80000000;

export function normalizeDbcId(rawId) {
  const n = Number(rawId) >>> 0;
  return (n & EXTENDED_ID_FLAG) ? (n & ~EXTENDED_ID_FLAG) >>> 0 : n;
}

/**
 * Parses DBC source text into { messages: Map<normalizedId, MessageDef> }.
 * MessageDef: { id, name, dlc, sender, signals: SignalDef[] }
 * SignalDef: { name, startBit, length, littleEndian, signed, factor, offset, min, max, unit }
 *
 * Throws with a human-readable message if no BO_ messages are found at all
 * (most likely sign of a non-DBC file being uploaded).
 */
export function parseDbc(text) {
  const lines = text.split(/\r?\n/);
  const messages = new Map();
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const boMatch = BO_RE.exec(line);
    if (boMatch) {
      const [, idStr, name, dlcStr, sender] = boMatch;
      const id = normalizeDbcId(idStr);
      current = { id, name, dlc: Number(dlcStr), sender, signals: [] };
      messages.set(id, current);
      continue;
    }

    if (line.trim().startsWith("SG_") && current) {
      const sgMatch = SG_RE.exec(line.trim());
      if (!sgMatch) continue; // skip multiplexer/malformed signal lines rather than failing the whole parse
      const [, name, startBitStr, lengthStr, order, sign, factorStr, offsetStr, minStr, maxStr, unit] = sgMatch;
      current.signals.push({
        name,
        startBit: Number(startBitStr),
        length: Number(lengthStr),
        littleEndian: order === "1",
        signed: sign === "-",
        factor: Number(factorStr),
        offset: Number(offsetStr),
        min: minStr.trim() === "" ? null : Number(minStr),
        max: maxStr.trim() === "" ? null : Number(maxStr),
        unit: unit || "",
      });
      continue;
    }

    // Any other top-level DBC section (BU_, CM_, VAL_, BA_, ...) ends
    // whatever message we were accumulating signals under.
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      current = null;
    }
  }

  if (messages.size === 0) {
    throw new Error("No CAN messages (BO_ entries) found — is this a valid .dbc file?");
  }

  return { messages };
}

/**
 * Extracts a signal's raw integer from an 8-byte CAN data array using DBC
 * bit numbering, per the Vector DBC spec:
 *  - Motorola (big-endian, littleEndian=false): startBit is the MSB's
 *    position numbered from byte 0 bit 7 down to byte 7 bit 0 (i.e. bit
 *    index = byte*8 + (7 - bitInByte)); bits are read from that MSB downward
 *    through the message, most-significant-first.
 *  - Intel (little-endian, littleEndian=true): startBit is the LSB's
 *    position numbered normally (byte*8 + bitInByte); bits are read upward
 *    from that LSB, least-significant-first.
 */
function extractRawBits(data, startBit, length, littleEndian) {
  let raw = 0n;
  if (littleEndian) {
    for (let i = 0; i < length; i++) {
      const bitPos = startBit + i;
      const byteIdx = bitPos >> 3;
      const bitInByte = bitPos & 7;
      const bit = (data[byteIdx] >> bitInByte) & 1;
      raw |= BigInt(bit) << BigInt(i);
    }
  } else {
    // Motorola: walk from the MSB bit down through the message, filling the
    // result from its own MSB downward.
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = bitPos >> 3;
      const bitInByte = bitPos & 7;
      const bit = (data[byteIdx] >> bitInByte) & 1;
      raw = (raw << 1n) | BigInt(bit);
      // Next bit down: within-byte position decreases; at byte boundary,
      // drop to bit 7 of the next byte.
      bitPos = bitInByte === 0 ? bitPos + 15 : bitPos - 1;
    }
  }
  return raw;
}

function toSigned(raw, length) {
  const signBit = 1n << BigInt(length - 1);
  return (raw & signBit) ? raw - (signBit << 1n) : raw;
}

/** Inverse of extractRawBits: writes `raw`'s low `length` bits into `data` at the DBC-numbered position. */
function packRawBits(data, startBit, length, littleEndian, raw) {
  if (littleEndian) {
    for (let i = 0; i < length; i++) {
      const bitPos = startBit + i;
      const byteIdx = bitPos >> 3;
      const bitInByte = bitPos & 7;
      const bit = Number((raw >> BigInt(i)) & 1n);
      data[byteIdx] = (data[byteIdx] & ~(1 << bitInByte) & 0xff) | (bit << bitInByte);
    }
  } else {
    // Motorola: the first bit written (index 0) is the signal's MSB, at
    // startBit; walk the same MSB-down path extractRawBits reads, writing
    // each bit of `raw` from its own MSB down as we go.
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = bitPos >> 3;
      const bitInByte = bitPos & 7;
      const bit = Number((raw >> BigInt(length - 1 - i)) & 1n);
      data[byteIdx] = (data[byteIdx] & ~(1 << bitInByte) & 0xff) | (bit << bitInByte);
      bitPos = bitInByte === 0 ? bitPos + 15 : bitPos - 1;
    }
  }
}

/**
 * Decodes every signal of a message def against an 8-byte data array,
 * returning [{ name, value, unit }]. `data` shorter than a signal's byte
 * span is treated as zero-padded (missing bytes read as 0) rather than
 * thrown on, since a short/DLC-mismatched frame is still worth showing
 * partial info for in a raw monitor.
 */
export function decodeSignals(message, data) {
  const padded = Array.from({ length: 8 }, (_, i) => data[i] ?? 0);
  return message.signals.map((sig) => {
    let raw;
    try {
      raw = extractRawBits(padded, sig.startBit, sig.length, sig.littleEndian);
    } catch {
      return { name: sig.name, value: null, rawValue: null, unit: sig.unit, min: sig.min, max: sig.max };
    }
    const signedRaw = sig.signed ? toSigned(raw, sig.length) : raw;
    const physical = Number(signedRaw) * sig.factor + sig.offset;
    // rawValue is the pre-scaling integer straight off the wire (BUSMASTER's
    // Message Interpretation panel shows this alongside the physical value) -
    // kept as a plain Number since every DBC signal here is well under 53
    // bits, the point BigInt precision would matter. min/max are the DBC's
    // declared [min|max] range (often just what the bit width allows, e.g. a
    // 2-bit signal is always [0|3]) - carried through so a transmit form can
    // show/enforce it instead of silently clamping with no explanation.
    return { name: sig.name, value: physical, rawValue: Number(signedRaw), unit: sig.unit, min: sig.min, max: sig.max };
  });
}

/**
 * Inverse of decodeSignals: packs a { signalName: physicalValue } map into an
 * 8-byte data array per the message's DBC layout, for the Transmit panel.
 * Signals missing from `valuesByName` (or given as "", null, undefined) pack
 * as 0 raw, matching how an untouched/blank field should behave. Values are
 * clamped into the bit width they were given so e.g. a raw value of -5 for
 * an unsigned signal doesn't wrap into a huge number, and out-of-range
 * physical values are clamped to the signal's own [min,max] first when the
 * DBC declares one.
 */
export function encodeSignals(message, valuesByName) {
  const data = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const sig of message.signals) {
    let physical = valuesByName ? valuesByName[sig.name] : undefined;
    if (physical === "" || physical === null || physical === undefined || Number.isNaN(Number(physical))) {
      continue; // leave as 0 raw
    }
    physical = Number(physical);
    if (sig.min !== null && physical < sig.min) physical = sig.min;
    if (sig.max !== null && physical > sig.max) physical = sig.max;

    const rawFloat = sig.factor !== 0 ? (physical - sig.offset) / sig.factor : 0;
    let raw = BigInt(Math.round(rawFloat));

    const bitWidth = BigInt(sig.length);
    const modulus = 1n << bitWidth;
    if (sig.signed) {
      const half = 1n << (bitWidth - 1n);
      if (raw >= half) raw = half - 1n; // clamp rather than silently wrap
      if (raw < -half) raw = -half;
      if (raw < 0n) raw += modulus; // two's complement for storage
    } else {
      if (raw < 0n) raw = 0n;
      if (raw >= modulus) raw = modulus - 1n;
    }

    packRawBits(data, sig.startBit, sig.length, sig.littleEndian, raw);
  }
  return data;
}
