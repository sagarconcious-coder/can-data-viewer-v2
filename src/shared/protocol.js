/**
 * CAN protocol constants and byte-level helpers.
 *
 * Ported (faithfully, not guessed) from the legacy Aeidth CAN Viewer app at
 * can-data-viewer/js/renderer.js, js/pCanProcesses.js, js/newConfig.js and
 * js/configuration.js. Every numeric constant below (CRC polynomial, CAN IDs,
 * command bytes, byte offsets) was read directly from that source, not inferred.
 *
 * This file is shared between the Electron main process (serial I/O + framing)
 * and the renderer (decoding/formatting for the UI), so it must stay
 * dependency-free plain JS (CommonJS-safe, no browser/node-only APIs).
 */

// ─── CRC16 (confirmed from renderer.js: uint16_t_crc_16) ─────────────────────
// Polynomial 40961 (0xA001) reflected, init 0xFFFF, one-bit-at-a-time algorithm.
function crc16(buffer, length) {
  let crc = 0x0ffff;
  for (let i = 0; i < length; i++) {
    let lData = buffer[i];
    for (let j = 0; j < 8; j++) {
      if (((lData ^ crc) & 1) === 1) {
        crc = (crc >> 1) ^ 40961;
      } else {
        crc = crc >> 1;
      }
      lData = lData >> 1;
    }
  }
  return crc;
}

// ─── Byte <-> integer helpers (confirmed from renderer.js) ────────────────────
const byteArrayToInt4 = (b) => (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
const byteArrayToInt2 = (b) => {
  let out = (b[0] << 8) | b[1];
  out = (out << 16) >> 16;
  return out;
};
const byteArrayToUnsignedInt2 = (b) => (b[0] << 8) | b[1];
const byteArrayToInt1 = (b) => (b << 24) >> 24;
const byteArrayToUnsignedInt1 = (b) => (b << 24) >>> 24;
const bitShift = (byte, bitPosition) => (byte >> bitPosition) & 0x01;

function getBitDecimalValue(byteV, startBit, stopBit, exByteV = 255, exBitPos = 0) {
  let bytedec = 0;
  let power = 0;
  if (exByteV !== 255) {
    bytedec = bitShift(exByteV, exBitPos) * Math.pow(2, power);
    power++;
  }
  for (let i = startBit; i <= stopBit; i++) {
    bytedec += bitShift(byteV, i) * Math.pow(2, power);
    power++;
  }
  return bytedec;
}
const getBitValueFor24PlusS = (byteV, startBit, stopBit) =>
  getBitDecimalValue(byteV, startBit, stopBit, 255, 0);

const moreThanOneBitShift = (byteV, startBit, stopBit, exByteV = 255, exBitPos = 255) =>
  getBitDecimalValue(byteV, startBit, stopBit, exByteV, exBitPos);

const integerTo4ByteArray = (integer) => [
  integer & 0xff,
  (integer >> 8) & 0xff,
  (integer >> 16) & 0xff,
  (integer >> 24) & 0xff,
];
const integerTo2ByteArray = (integer) => [integer & 0xff, (integer >> 8) & 0xff];

// Config-struct-specific little-endian readers (confirmed from newConfig.js)
const configByteArrayToInt4 = (b) => ((b[3] << 24) | (b[2] << 16) | (b[1] << 8) | b[0]) >>> 0;
const configByteArrayToInt2 = (b) => (b[1] << 8) | b[0];
function byteToSigned(byte) {
  return byte & 0x80 ? byte - 256 : byte;
}

// ─── Framing (confirmed from renderer.js CommandCenter()) ─────────────────────
// [0x2A,0x26,0x24, messageId, canId0..3, dataLen=8, data0..7, crcLo, crcHi, 0x0D, 0x0A]
// CRC16 is computed over the first 17 bytes (header+canId+len+8 data bytes).
function buildCommandFrame(canIdBytes, messageId, dataArray) {
  const frame = new Array(21).fill(0);
  frame[0] = 0x2a;
  frame[1] = 0x26;
  frame[2] = 0x24;
  frame[3] = messageId;
  frame[4] = canIdBytes[0];
  frame[5] = canIdBytes[1];
  frame[6] = canIdBytes[2];
  frame[7] = canIdBytes[3];
  frame[8] = 8;
  for (let i = 0; i < 8; i++) frame[9 + i] = dataArray[i] ?? 0;
  const crcInput = frame.slice(0, 17);
  const crc = crc16(crcInput, 17);
  frame[17] = crc & 0xff;
  frame[18] = (crc >> 8) & 0xff;
  frame[19] = 0x0d;
  frame[20] = 0x0a;
  return frame;
}

// ─── CAN IDs (decimal, exactly as used in dataOperation()/renderer.js) ────────
const CAN_ID = {
  LOGIN_TX: 512496471, // login command target
  LOGIN_RX: 512496471, // heartbeat/login echo (same id observed on RX too: 512496471 case)
  CMD_TX: 512496474, // aeidthCanTool command channel (config fetch, bootloader entry, custom cmds)
  HEARTBEAT: 412496471, // battery voltage/current/SOC/FET/fault bits (EV BMS)
  HEARTBEAT_ALT: 512496498, // alt heartbeat layout (bit order differs)
  CAPACITY_SOH: 412496472,
  CELL_MINMAX_TEMP: 412496473,
  CELL_VOLT_0: 412496474,
  CELL_VOLT_1: 412496475,
  CELL_VOLT_2: 412496476,
  CELL_VOLT_3: 412496477,
  CELL_VOLT_4: 412496478,
  CELL_VOLT_5: 412496479,
  CELL_VOLT_6: 412496480,
  TEMP_0: 412496481,
  TEMP_1: 412496482,
  BMS_STATES: 412496483,
  BATTERY_SERIAL: 412496470,
  WARNING_FLAGS: 412496484,
  ENERGY: 412496485,
  TIMESTAMP: 419358208,
  BMS_MODEL_ID: 412496491,
  BMS_CONFIG_VERSION: 412496490,
  PDU_HW_VERSION: 412496489,
  BMS_HW_VERSION: 412496488,
  BMS_FW_VERSION: 412496487,
  PIN_STATES: 412496492,
  CELL_BALANCING: 412496496,
  RBMS_TIME_SETTINGS: 512496492, // also used as RBMS config TX id
  RBMS_CONFIG_DATA: 412496499,
  CELL_TEMP_MASK: 216990371,
  BMU_MODEL_ID: 16711736,
  BMU_UUID: 16711737, // NOTE: legacy source also (bug) reuses this id for bmuCountSetReceived, see README
  WARNING_DATA: 216990369,
  BOOTLOADER_RX: 512496494,
  CONFIG_ARRAY: 412496486,
  CONFIG_TX: 216990112, // 0x0CEF00A0 - config write target (sendConfig() in renderer.js), 23 frames of [index, 7 bytes]
  CELLS_24S_META: 412496498,
  CELLS_24S_DATA: 412496497,
  TEMP_24S_DATA: 412496493,
  EXTR_TEMP_24S_DATA: 412496494,
  BATTERY_PACK_ID: 512496499,
  XMODEM_DATA: 512496493,
  XMODEM_CTRL: 512496495,
  // Parallel-view IDs are hex-prefix based (0x14F3xx/0x14F4xx/0x14F6xx), see decodeParallel()
  BMU_CTRL_NORMAL: 0xff51,
  BMU_CTRL_REQUEST: 0xff21,
  BMU_CTRL_COUNT: 0xff24,
  BMU_CTRL_MMID: 0xff25,
  BMU_CTRL_UUID: 0xff26,
  BMU_MODEL_ID_RX: 16711736, // 0xFF0038 - reply to BMU_CTRL_REQUEST [1, 0x17], 8 ASCII chars in bytes 9-16
  BMU_UUID_RX: 16711737, // 0xFF0039 - reply to BMU_CTRL_REQUEST [1, 0x18], [index, 7 ASCII chars] x2
  WARNING_TX: 0x0cef02a0,
  CELL_TEMP_MASK_TX: 0x0cef02a2,
};

// BMS config-fetch command byte is 0x6d, RBMS is 0x44 (confirmed fix in renderer.js fetchConfiguration()).
const CONFIG_CMD_BYTE = { bms: 0x6d, rbms: 0x44 };

// ─── CAN bus baud rate (confirmed from renderer.js getBaudRate()/setBaudRate()) ───
// This configures the CAN transceiver's bus speed and is sent to CAN ID 974256
// (messageId 2, dataArray [index,0,0,0,0,0,0,0]) immediately after the serial
// port opens and whenever the user changes it. It is NOT the same as the
// serial/UART baud rate between the PC and the CAN-to-USB adapter — that stays
// fixed. Without sending this, the device and PC's CAN transceivers may be
// running at mismatched bus speeds and the device will never reply to any
// command (config fetch included), even though the serial link itself is open.
const CAN_BUS_BAUD_ID = 974256;

// ─── BMU tool commands (GUI <-> CAN tool packet sheet) ───────────────────────
// All requests and the addressing response share CAN ID 974261. Byte 0 is the
// command, byte 1 its argument, the rest are zero:
//   [1, 1]   start BMU addressing   -> response [1, addrInStatus, addrOutStatus]
//   [2, 0]   stop data (DataByte1 = 2 per the packet sheet; DataByte2 = 0 is
//            unconfirmed). The GUI's Start Data only sends the addressing
//            request above - [2, 1] is not sent.
//   [3, 1/0] FAN on / off
// Start data and FAN must only be sent once Address IN has passed. The tool
// has to be in BMU mode for any of this to be answered.
const BMU_TOOL_ID = 974261;
// Same tool-addressed messageId as CAN_BUS_BAUD_ID (974256) - both IDs belong
// to the CAN tool itself rather than a device on the bus.
const BMU_TOOL_MESSAGE_ID = 2;
const BMU_TOOL_CMD = { ADDRESSING: 1, START_DATA: 2, FAN: 3 };
// Value of the Address IN/OUT status bytes that means "pass".
const BMU_ADDRESS_PASS = 1;
const CAN_BUS_BAUD_OPTIONS = [
  { index: 1, label: "125 kbps" },
  { index: 2, label: "250 kbps" },
  { index: 3, label: "500 kbps" },
  { index: 4, label: "1 Mbps" },
];

const FaultArray = [
  "No Fault", "Over Pack Voltage Fault", "Over Pack Voltage", "Under Pack Voltage Fault",
  "Over OCD1 Current", "Over OCD2 Current", "Over Charge Current", "Over Discharge Current",
  "Short Circuit", "Cell Open Wire Fault", "Voltage Reference Fault", "Voltage Regulator Fault",
  "Temperature Multiplexer Error", "Under Temperature Fault", "Load Over Temperature",
  "Oscillator Fault", "Watchdog Timeout Fault", "Under Cell Voltage Fault", "Over Cell Voltage Fault",
  "Open Wire Fault", "Over Temperature Fault", "Cell Unbalance Pro", "SCD Latch High",
  "SPI Communication Fault", "I2C Communication Fault", "MCU Reset Fault", "Data CRC Error Fault",
  "Data Ready Fault", "Charger Authentication Failed", "Thermal Runaway Due To Temperature",
  "Thermal Runaway Due To Voltage", "MOSFET Drive Voltage Fault", "Reserve Condition Reached",
  "Battery Empty Reached", "Battery Full Charged Reached", "Weld Check Fault", "Fuse Burn Fault",
  "PCU Over Temp Fault", "Cell Temperature Imbalance Fault", "Precharge Complete Fault",
  "Battery Dead Fault Due To Cell Or Temp", "Energy Disburse Complete",
  "Hard Cell Over Voltage Protection", "Hard Cell Under Voltage Protection", "Low SOH Protection",
];
const bmsPowerModeArray = ["Active Mode", "Sleep Mode", "Deep Sleep Mode", "Sleep Wake Up Sleep"];
const packCurrentStateArray = ["None", "Charging", "Discharging", "Normal", "Ideal", "Current Sleep", "Regen"];
const alarmArray = [
  "None", "Over Pack Voltage Alarm", "Under Pack Voltage Alarm", "Over Charge Current Alarm",
  "Over DisCharge Current Alarm", "Cell Under Temp Alarm", "Cell Over Temp Alarm",
  "PDU Over Temp Alarm", "Under Cell Voltage Alarm", "Over Cell Voltage Alarm",
  "Cell UnBal Pro Alarm", "Full Charge Alarm", "Full Discharge Alarm",
  "Reach Reserve 1 Alarm", "Reach Reserve 2 Alarm",
];
const warningValueArray = ["WAR_ERR_NONE", "WAR_ERR_IN_WARNING", "WAR_ERR_IN_ERROR"];

// ─── BMS/RBMS configuration struct: 160 meaningful bytes, accumulated by the
// legacy app until its buffer reaches 161 bytes (byte 160 is an unread
// trailing pad — confirmed by counting configurationArray[starter++] reads in
// js/newConfig.js assignConfiguration(), which totals exactly 160, while the
// "packet complete" check in renderer.js/pCanProcesses.js tests length===161).
// Field order/widths cross-checked against the commented-out authoritative
// layout in js/configuration.js. ───────────────────────────────────────────
// type: u1 (uint8), i1 (int8, signed), u2 (uint16 LE), u4 (uint32 LE)
const CONFIG_FIELDS = [
  { key: "NumberOfCells", type: "u1", label: "Number Of Cells", unit: "", range: "0-96" },
  { key: "NumberOfTemp", type: "u1", label: "Number Of Temp", unit: "", range: "0-255" },
  { key: "TypeOfCell", type: "u1", label: "Type Of Cell", unit: "", range: "0-20" },
  { key: "CellManufacturer", type: "u1", label: "Cell Manufacturer", unit: "", range: "" },
  { key: "CAN_Status", type: "u1", label: "CAN Status", unit: "", range: "" },
  { key: "BLE_Status", type: "u1", label: "BLE Status", unit: "", range: "" },
  { key: "IOT_Status", type: "u1", label: "IOT Status", unit: "", range: "" },
  { key: "IMU_Status", type: "u1", label: "IMU Status", unit: "", range: "" },
  { key: "BarGraph_Status", type: "u1", label: "BarGraph Status", unit: "", range: "" },
  { key: "DischargingRate", type: "u1", label: "Discharging Rate", unit: "C", range: "0-50" },
  { key: "MemorySize", type: "u2", label: "Memory Size", unit: "kB", range: "0-1024" },
  { key: "DesignCapacity", type: "u4", label: "Design Capacity", unit: "mAh", range: "0-655355" },
  { key: "CycleCapacity", type: "u2", label: "Cycle Capacity", unit: "", range: "0-655355" },
  { key: "FullChargeVol", type: "u4", label: "Full Charge Voltage", unit: "mV", range: "0-655355" },
  { key: "ChargeEndVol", type: "u4", label: "Charge End Voltage", unit: "mV", range: "0-655355" },
  { key: "CycleCount", type: "u2", label: "Cycle Count", unit: "", range: "" },
  { key: "ChgOverTemp", type: "i1", label: "Charge Over Temperature", unit: "°C", range: "-40-120" },
  { key: "ChgOTRelease", type: "i1", label: "Charge Over Temperature Release", unit: "°C", range: "-40-120" },
  { key: "ChgUnderTemp", type: "i1", label: "Charge Under Temperature", unit: "°C", range: "-40-120" },
  { key: "ChgUTRelease", type: "i1", label: "Charge Under Temperature Release", unit: "°C", range: "-40-120" },
  { key: "LoadOverTemp", type: "i1", label: "Load Over Temp", unit: "°C", range: "-40-120" },
  { key: "LoadOTRelease", type: "i1", label: "Load Over Temp Release", unit: "°C", range: "-40-120" },
  { key: "LoadLowTemp", type: "i1", label: "Load Low Temp", unit: "°C", range: "-40-120" },
  { key: "LoadUTRelease", type: "i1", label: "Load Under Temp Release", unit: "°C", range: "-40-120" },
  { key: "DisOverTemp", type: "i1", label: "Discharge Over Temp", unit: "°C", range: "-40-120" },
  { key: "DsgOTRelease", type: "i1", label: "Discharge Over Temperature Release", unit: "°C", range: "-40-120" },
  { key: "DisLowTemp", type: "i1", label: "Discharge Low Temp", unit: "°C", range: "-40-120" },
  { key: "DsgUTRelease", type: "i1", label: "Discharge Under Temperature Release", unit: "°C", range: "-40-120" },
  { key: "PackOverVoltage", type: "u4", label: "Pack Over Voltage", unit: "mV", range: "0-655355" },
  { key: "PackOVRelease", type: "u4", label: "Pack Over Voltage Release", unit: "mV", range: "0-655355" },
  { key: "PackUnderVoltage", type: "u4", label: "Pack Under Voltage", unit: "mV", range: "0-655355" },
  { key: "PackUVRelease", type: "u4", label: "Pack Under Voltage Release", unit: "mV", range: "0-655355" },
  { key: "CellFullChrVoltage", type: "u2", label: "Cell Full Charge Voltage", unit: "mV", range: "0-5000" },
  { key: "CellNominalVoltage", type: "u2", label: "Cell Nominal Voltage", unit: "mV", range: "0-5000" },
  { key: "CellOverVoltage", type: "u2", label: "Cell Over Voltage", unit: "mV", range: "0-5000" },
  { key: "CellOVRelease", type: "u2", label: "Cell Over Voltage Release", unit: "mV", range: "0-5000" },
  { key: "CellUnderVoltage", type: "u2", label: "Cell Under Voltage", unit: "mV", range: "0-5000" },
  { key: "CellUVRelease", type: "u2", label: "Cell Under Voltage Release", unit: "mV", range: "0-5000" },
  { key: "CellUnBalProtec", type: "u2", label: "Cell Unbalance Protection", unit: "mV", range: "0-500" },
  { key: "OverChargeCurrent", type: "u4", label: "Over Charge Current", unit: "mA", range: "0-655355" },
  { key: "OverDisCurrent", type: "u4", label: "Over Discharge Current", unit: "mA", range: "0-655355" },
  { key: "BalanceStartVoltage", type: "u2", label: "Balance Start Voltage", unit: "mV", range: "0-5000" },
  { key: "SenseResistor", type: "u2", label: "Sense Resistor", unit: "", range: "" },
  { key: "BatteryConfig", type: "u2", label: "Battery Config", unit: "", range: "" },
  { key: "NtcConfig", type: "u2", label: "NTC Config", unit: "", range: "" },
  { key: "CANBaudrate", type: "u4", label: "CAN Baudrate", unit: "kbps", range: "125-1000" },
  { key: "fet_ctrl_time_set", type: "u2", label: "FET Control Time", unit: "", range: "0-65535" },
  { key: "led_disp_time_set", type: "u2", label: "LED Display Time", unit: "", range: "0-65535" },
  { key: "VoltageCap80", type: "u2", label: "Voltage Cap 80%", unit: "mV", range: "0-655355" },
  { key: "VoltageCap60", type: "u2", label: "Voltage Cap 60%", unit: "mV", range: "0-655355" },
  { key: "VoltageCap40", type: "u2", label: "Voltage Cap 40%", unit: "mV", range: "0-655355" },
  { key: "VoltageCap20", type: "u2", label: "Voltage Cap 20%", unit: "mV", range: "0-655355" },
  { key: "HardCellOverVoltage", type: "u2", label: "Hard Cell Over Voltage", unit: "mV", range: "0-5000" },
  { key: "HardCellUnderVoltage", type: "u2", label: "Hard Cell Under Voltage", unit: "mV", range: "0-5000" },
  { key: "HardPackOverVoltage", type: "u4", label: "Hard Pack Over Voltage", unit: "mV", range: "0-655355" },
  { key: "HardPackUnderVoltage", type: "u4", label: "Hard Pack Under Voltage", unit: "mV", range: "0-655355" },
  { key: "HardChgOverCurrent", type: "u4", label: "Hard Charge Over Current", unit: "mA", range: "0-655355" },
  { key: "HardDsgOverCurrent", type: "u4", label: "Hard Discharge Over Current", unit: "mA", range: "0-655355" },
  { key: "SleepModeTimeAtIgnOn", type: "u2", label: "Sleep Mode Time At Ignition On", unit: "ms", range: "" },
  { key: "SCReleaseTime", type: "u2", label: "Short Circuit Release Time", unit: "ms", range: "0-65535" },
  { key: "ChgUTDelay", type: "u2", label: "Charge Under Temp Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "ChgOTDelay", type: "u2", label: "Charge Over Temp Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "DsgUTDelay", type: "u2", label: "Discharge Under Temp Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "DsgOTDelay", type: "u2", label: "Discharge Over Temp Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "PackUVDelay", type: "u2", label: "Pack Under Voltage Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "PackOVDelay", type: "u2", label: "Pack Over Voltage Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "CellUVDelay", type: "u2", label: "Cell Under Voltage Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "CellOVDelay", type: "u2", label: "Cell Over Voltage Delay", unit: "s", range: "0-65534", delayScaled: true },
  { key: "ChgOCDelay", type: "u2", label: "Charge Over Current Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "ChgOCRDelay", type: "u2", label: "Charge Over Current Release Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "DsgOCDelay", type: "u2", label: "Discharge Over Current Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "DsgOCRDelay", type: "u2", label: "Discharge Over Current Release Delay", unit: "s", range: "0-65535", delayScaled: true },
  { key: "GPS_TIME", type: "u2", label: "GPS Time", unit: "", range: "0-65535" },
  { key: "GPS_VOL", type: "u2", label: "GPS Voltage", unit: "", range: "0-655355" },
  { key: "PreChargeTime", type: "u2", label: "Pre Charge Time", unit: "", range: "0-65535" },
  { key: "BalanceWindow", type: "u1", label: "Balance Window", unit: "mV", range: "0-255" },
  { key: "ReserveCapacityS1", type: "u1", label: "Reserve Capacity S1", unit: "%", range: "0-100" },
  { key: "ReserveCapacityS2", type: "u1", label: "Reserve Capacity S2", unit: "%", range: "0-100" },
  { key: "DataEnd", type: "u1", label: "Data End Marker", unit: "", range: "" },
];

// Field -> UI tab grouping, matching index.html's Cell/Pack/Temperature/PDU/Other tabs.
const CONFIG_TABS = {
  cell: [
    "BalanceStartVoltage", "BalanceWindow", "CellFullChrVoltage", "CellNominalVoltage",
    "CellUnderVoltage", "CellOverVoltage", "CellOVRelease", "CellOVDelay",
    "HardCellOverVoltage", "CellUVRelease", "CellUVDelay", "HardCellUnderVoltage",
    "CellUnBalProtec",
  ],
  pack: [
    "CANBaudrate", "NumberOfTemp", "TypeOfCell", "DesignCapacity", "CycleCapacity",
    "FullChargeVol", "ChargeEndVol", "DischargingRate", "PackOverVoltage", "PackOVRelease",
    "PackOVDelay", "HardPackOverVoltage", "PackUnderVoltage", "PackUVRelease", "PackUVDelay",
    "HardPackUnderVoltage",
  ],
  temperature: [
    "ChgOverTemp", "ChgOTRelease", "ChgOTDelay", "ChgUnderTemp", "ChgUTRelease", "ChgUTDelay",
    "DisOverTemp", "DsgOTRelease", "DsgOTDelay", "DisLowTemp", "DsgUTRelease", "DsgUTDelay",
    "LoadOverTemp", "LoadOTRelease", "LoadLowTemp", "LoadUTRelease",
  ],
  pdu: [
    "OverChargeCurrent", "ChgOCDelay", "ChgOCRDelay", "HardChgOverCurrent", "OverDisCurrent",
    "DsgOCDelay", "DsgOCRDelay", "HardDsgOverCurrent", "ReserveCapacityS1", "ReserveCapacityS2",
    "SCReleaseTime",
  ],
  other: [
    "NumberOfCells", "CellManufacturer", "CAN_Status", "BLE_Status", "IOT_Status", "IMU_Status",
    "BarGraph_Status", "MemorySize", "CycleCount", "SenseResistor", "BatteryConfig", "NtcConfig",
    "fet_ctrl_time_set", "led_disp_time_set", "VoltageCap80", "VoltageCap60", "VoltageCap40",
    "VoltageCap20", "GPS_TIME", "GPS_VOL", "PreChargeTime",
  ],
};

/**
 * Decode the 160-byte config struct into a keyed object (caller may pass a
 * 161-byte buffer; only the first 160 bytes are consumed, matching the legacy
 * app exactly).
 * delayDivisor: BMS divides delay fields by 10 (they're sent in deciseconds),
 * RBMS does not (confirmed in newConfig.js assignConfiguration()).
 */
function decodeConfigArray(bytes, deviceType) {
  let idx = 0;
  const out = {};
  const delayDivisor = deviceType === "bms" ? 10 : 1;
  for (const field of CONFIG_FIELDS) {
    let raw;
    if (field.type === "u4") {
      raw = configByteArrayToInt4([bytes[idx], bytes[idx + 1], bytes[idx + 2], bytes[idx + 3]]);
      idx += 4;
    } else if (field.type === "u2") {
      raw = configByteArrayToInt2([bytes[idx], bytes[idx + 1]]);
      idx += 2;
    } else if (field.type === "i1") {
      raw = byteToSigned(bytes[idx]);
      idx += 1;
    } else {
      raw = bytes[idx];
      idx += 1;
    }
    if (field.delayScaled) raw = raw / delayDivisor;
    out[field.key] = raw;
  }
  return out;
}

/** Encode a config values object back into the 161-byte array for writing. */
function encodeConfigArray(values, deviceType) {
  const out = [];
  const delayMultiplier = deviceType === "bms" ? 10 : 1;
  for (const field of CONFIG_FIELDS) {
    let val = Number(values[field.key]) || 0;
    if (field.delayScaled) val = Math.round(val * delayMultiplier);
    if (field.type === "u4") {
      out.push(...integerTo4ByteArray(val));
    } else if (field.type === "u2") {
      out.push(...integerTo2ByteArray(val));
    } else {
      out.push(val & 0xff);
    }
  }
  return out;
}

// ─── ESM export ────────────────────────────────────────────────────────────
// This is the single source of truth for the protocol, written as an ES
// module so Vite/React (renderer, both dev-server and production build) can
// import it directly. The Electron main process (plain CommonJS,
// src/main/serialManager.js) never needs these helpers directly: frames are
// built in the renderer (canCommands.js) and only the finished byte array
// crosses IPC to sendFrame(), so no CJS re-export of this file is required.
const api = {
  crc16,
  buildCommandFrame,
  byteArrayToInt4,
  byteArrayToInt2,
  byteArrayToUnsignedInt2,
  byteArrayToInt1,
  byteArrayToUnsignedInt1,
  bitShift,
  getBitValueFor24PlusS,
  moreThanOneBitShift,
  integerTo4ByteArray,
  integerTo2ByteArray,
  configByteArrayToInt4,
  configByteArrayToInt2,
  byteToSigned,
  CAN_ID,
  CONFIG_CMD_BYTE,
  CAN_BUS_BAUD_ID,
  BMU_TOOL_ID,
  BMU_TOOL_MESSAGE_ID,
  BMU_TOOL_CMD,
  BMU_ADDRESS_PASS,
  CAN_BUS_BAUD_OPTIONS,
  FaultArray,
  bmsPowerModeArray,
  packCurrentStateArray,
  alarmArray,
  warningValueArray,
  CONFIG_FIELDS,
  CONFIG_TABS,
  decodeConfigArray,
  encodeConfigArray,
};

export default api;
