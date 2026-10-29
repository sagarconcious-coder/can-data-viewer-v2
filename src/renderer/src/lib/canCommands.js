import protocol from "../../../shared/protocol.js";

const { buildCommandFrame, integerTo4ByteArray, CAN_ID, CONFIG_CMD_BYTE, CAN_BUS_BAUD_ID, BMU_TOOL_ID, BMU_TOOL_MESSAGE_ID } =
  protocol;

/**
 * Send a CAN command frame over the currently-open transport (serial or
 * PCAN).
 *
 * `frameType` is optional and additive: pass 0 for a standard/11-bit id or 1
 * for extended/29-bit to append that as a 22nd byte, which pcanManager.js
 * reads to set the real MSGTYPE on write (serialManager.js strips it back
 * off before the wire write, since the legacy serial protocol has no such
 * bit - see both files' sendFrame comments). Leave it unset (the default for
 * every call site in this app's own protocol, which is entirely 29-bit
 * extended ids) to keep today's behavior unchanged.
 */
export async function sendCommand(canIdDecimal, messageId, dataArray, frameType) {
  const canIdBytes = integerTo4ByteArray(canIdDecimal);
  const frame = buildCommandFrame(canIdBytes, messageId, dataArray);
  if (frameType === 0 || frameType === 1) frame.push(frameType);
  console.log(
    "[canCommands] sendCommand canId=%s messageId=%s frame=%s",
    canIdDecimal,
    messageId,
    frame.map((b) => b.toString(16).padStart(2, "0")).join(" "),
  );
  const result = await window.canApi.sendFrame(frame);
  if (!result || !result.success) {
    console.error("[canCommands] sendFrame FAILED", result);
  }
  return result;
}

/** CANLoginCommandSend() ported from renderer.js — required before most config fetches. */
export async function sendCanLogin() {
  return sendCommand(CAN_ID.LOGIN_TX, 1, [0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38]);
}

/**
 * fetchConfiguration() ported from renderer.js. Sends the ADT&-prefixed
 * command with the device-specific config byte: 0x6d for BMS, 0x44 for RBMS.
 * This is the exact fix confirmed in the current renderer.js source.
 */
export async function sendFetchConfiguration(deviceType) {
  await sendCanLogin();
  await sleep(10);
  const cmdByte = deviceType === "bms" ? CONFIG_CMD_BYTE.bms : CONFIG_CMD_BYTE.rbms;
  const dataArray = [0x41, 0x44, 0x54, 0x26, cmdByte, 0x00, 0x00, 0x00];
  return sendCommand(CAN_ID.CMD_TX, 1, dataArray);
}

/**
 * setBaudRate() ported from renderer.js. Configures the device's CAN
 * transceiver bus speed (125/250/500 kbps, 1 Mbps — sent as an index 1-4).
 * Must be sent after connecting (and again whenever the user changes the CAN
 * baud selector) or the device will silently never reply to any command,
 * including configuration fetch, even though the serial link is open.
 */
export async function sendCanBusBaudRate(baudIndex) {
  const dataArray = [Number(baudIndex), 0, 0, 0, 0, 0, 0, 0];
  return sendCommand(CAN_BUS_BAUD_ID, 2, dataArray);
}

/**
 * rs485StartInterval() ported from renderer.js. RS485-connected devices need
 * a periodic poll (every 1s, ADT+A rather than the ADT&-prefixed config/login
 * commands) to keep the link active - without it the old app observed the
 * device stop responding after a period of inactivity. aeidthCanTool/PCAN
 * don't need this; it's RS485-specific.
 */
export async function sendRs485Keepalive() {
  const dataArray = [0x41, 0x44, 0x54, 0x2b, 0x41, 0x00, 0x00, 0x00];
  return sendCommand(CAN_ID.CMD_TX, 1, dataArray);
}

/** Generic ADT&-prefixed custom command sender (Control Center / RBMS Command Center). */
export async function sendCustomAdtCommand(cmdByte, extraBytes = [0, 0, 0]) {
  await sendCanLogin();
  await sleep(10);
  const dataArray = [0x41, 0x44, 0x54, 0x26, cmdByte, ...extraBytes].slice(0, 8);
  while (dataArray.length < 8) dataArray.push(0);
  return sendCommand(CAN_ID.CMD_TX, 1, dataArray);
}

/**
 * BMU tool command on CAN ID 974261 (see BMU_TOOL_ID in protocol.js):
 * [cmd, value, 0, 0, 0, 0, 0, 0]. Use BMU_TOOL_CMD for `cmd`.
 */
export async function sendBmuToolCommand(cmd, value) {
  return sendCommand(BMU_TOOL_ID, BMU_TOOL_MESSAGE_ID, [cmd, value, 0, 0, 0, 0, 0, 0]);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
