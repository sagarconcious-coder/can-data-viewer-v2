import protocol from "../../../shared/protocol.js";
import { sendCommand, sendCanLogin, sleep } from "./canCommands.js";

const { CAN_ID } = protocol;

/**
 * Local-serial xModem firmware flashing, ported from js/firmwareUpdate.js.
 * Only the serial/CAN mechanics are kept — the backend fetch-by-filename flow
 * (POST /bms/fota_file) and the firmware_update_log audit call are dropped,
 * per the requirement to skip backend/licensing machinery. A local .bin file
 * picked by the user is used instead of a server-hosted one.
 */

// xModemCrcFunction(), confirmed from firmwareUpdate.js — CRC-CCITT (XMODEM), poly 0x1021, init 0.
function xmodemCrc16(bytes) {
  let crc = 0;
  for (let j = 0; j < bytes.length; j++) {
    crc ^= bytes[j] << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    crc &= 0xffff;
  }
  return crc;
}

/** getFileChunks(): pad to a multiple of 128 bytes with 0xFF, split into 128-byte chunks. */
export function chunkFirmwareFile(byteArray) {
  const chunkSize = 128;
  const arr = Array.from(byteArray);
  const remainder = arr.length % chunkSize;
  if (remainder !== 0) {
    arr.push(...new Array(chunkSize - remainder).fill(0xff));
  }
  const chunks = [];
  for (let i = 0; i < arr.length; i += chunkSize) chunks.push(arr.slice(i, i + chunkSize));
  const packetNumbers = chunks.map((_, i) => (i + 1) % 256);
  return { chunks, packetNumbers };
}

/** xModemDataPacketCreation(): build & send one 128-byte chunk as CAN frames of 8 bytes each. */
export async function sendXmodemPacket(chunks, packetNumbers, index) {
  const chunk = chunks[index];
  const packetNo = packetNumbers[index];
  const dataPacket = [0x01, packetNo, 255 - packetNo, ...chunk];
  const crc = xmodemCrc16(chunk);
  dataPacket.push((crc >> 8) & 0xff, crc & 0xff);

  for (let i = 0; i < dataPacket.length; i += 8) {
    let frame = dataPacket.slice(i, i + 8);
    while (frame.length < 8) frame.push(0);
    await sleep(2);
    await sendCommand(CAN_ID.XMODEM_DATA, 1, frame);
  }
}

/** CANDataPacketCommandSend(): single-byte control command on the xModem control channel. */
export async function sendXmodemControl(val) {
  await sendCommand(CAN_ID.XMODEM_CTRL, 1, [val, 0, 0, 0, 0, 0, 0, 0]);
}

/** CANBootLoaderCommandSend(): switch the device into bootloader mode. */
export async function sendBootloaderEntry() {
  await sendCommand(CAN_ID.CMD_TX, 1, [0x41, 0x44, 0x54, 0x26, 0x70, 0x00, 0x00, 0x00]);
}

/** UpdateCode() entry point: login, then request bootloader mode. */
export async function startFirmwareUpdate() {
  await sendCanLogin();
  await sleep(100);
  await sendBootloaderEntry();
}

/**
 * CreateDataPackets(): the bootloader handshake state machine driven by
 * CAN_ID.BOOTLOADER_RX (512496494) responses, cmd1/cmd2 = data[9]/data[10].
 * Returns a description of what to do next; the caller (React page) drives
 * the actual sends and updates UI/progress state.
 */
export function interpretBootloaderResponse(cmd1, cmd2) {
  if (cmd1 === 48 && cmd2 === 72) return { status: "In Boot Loader mode", action: "send-control", value: 0x48 };
  if (cmd1 === 48 && cmd2 === 74) return { status: "Step 1: entering flash mode", action: "send-control", value: 0x31 };
  if (cmd1 === 48 && cmd2 === 75) return { status: "Step 2: blank check complete", action: "send-control", value: 0x32 };
  if (cmd1 === 48 && cmd2 === 76) return { status: "Step 3: erase complete", action: "send-control", value: 0x33 };
  if (cmd1 === 48 && cmd2 === 78) return { status: "Step 4: entering xModem mode", action: "none" };
  if (cmd1 === 67 && cmd2 === 78) return { status: "Step 5: uploading firmware", action: "xmodem-send", index: 0 };
  if (cmd1 === 6 && cmd2 === 78) return { status: "ack", action: "xmodem-ack" };
  if (cmd1 === 21 && cmd2 === 78) return { status: "nack", action: "xmodem-nack" };
  if (cmd1 === 48 && cmd2 === 80) return { status: "Upload complete", action: "send-control", value: 0x34 };
  if (cmd1 === 48 && cmd2 === 81) return { status: "Flash program failed, retrying…", action: "none" };
  if (cmd1 === 48 && cmd2 === 79) return { status: "Timeout, retrying…", action: "none" };
  if (cmd1 === 48 && cmd2 === 83) return { status: "Restarting the process", action: "none" };
  if (cmd1 === 48 && cmd2 === 82) return { status: "Process complete", action: "done" };
  return { status: "Unknown response", action: "none" };
}

/** Sends the CAN "EOT" (end of transmission) control byte after the last xModem chunk. */
export async function sendXmodemEot() {
  await sendCommand(CAN_ID.XMODEM_DATA, 1, [0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}
