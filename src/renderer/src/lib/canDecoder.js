import protocol from "../../../shared/protocol.js";

const {
  byteArrayToInt4,
  byteArrayToInt2,
  byteArrayToUnsignedInt2,
  byteArrayToInt1,
  byteArrayToUnsignedInt1,
  bitShift,
  moreThanOneBitShift,
  getBitValueFor24PlusS,
  CAN_ID,
  BMU_TOOL_ID,
  BMU_TOOL_CMD,
  FaultArray,
  packCurrentStateArray,
  decodeConfigArray,
} = protocol;

const textDecode = (bytes) => {
  const filtered = bytes.filter((n) => n !== 0);
  try {
    return new TextDecoder().decode(new Uint8Array(filtered));
  } catch {
    return "";
  }
};

/**
 * Pure, faithful port of dataOperation() from js/renderer.js / js/pCanProcesses.js.
 * Takes a 21-byte frame (array of numbers) and a mutable `state` object, and
 * returns a shallow-merged patch describing what changed. The caller
 * (useCanLiveData hook) owns the actual state object and re-renders React.
 *
 * `state.configBuffer` accumulates bytes for the 161-byte BMS/RBMS config read.
 */
export function decodeFrame(data, state, deviceType) {
  const patch = {};
  const canId = [data[7], data[6], data[5], data[4]];
  const canValue = byteArrayToInt4(canId);

  // ── Parallel view (hex-prefix based IDs 0x14F3xx / 0x14F4xx / 0x14F6xx) ──
  const hex1 = data[7].toString(16);
  const hex2 = data[6].toString(16);
  if (hex1 === "14") {
    if (hex2 === "f3") {
      patch.parallel = {
        type: "voltageSoc",
        batteryPackId: byteArrayToUnsignedInt2([data[11], data[12]]),
        batteryVoltage: byteArrayToUnsignedInt2([data[9], data[10]]) / 100,
        maxTemperature: byteArrayToInt1(data[13]),
        minTemperature: byteArrayToInt1(data[14]),
        soc: byteArrayToUnsignedInt1(data[15]),
        fullChargeBit: bitShift(data[16], 0),
        ignitionState: bitShift(data[16], 1),
        lowCellBit: bitShift(data[16], 2),
        highCellBit: bitShift(data[16], 3),
        highPackBit: bitShift(data[16], 4),
        canIgnition: bitShift(data[16], 5),
        pinChgEn: bitShift(data[16], 6),
        pinDsgEn: bitShift(data[16], 7),
      };
    } else if (hex2 === "f4") {
      patch.parallel = {
        type: "currentState",
        batteryPackId: byteArrayToUnsignedInt2([data[11], data[12]]),
        current: byteArrayToInt2([data[9], data[10]]) / 100,
        maxTemperatureNum: byteArrayToUnsignedInt1(data[13]),
        minTemperatureNum: byteArrayToUnsignedInt1(data[14]),
        packState: packCurrentStateArray[moreThanOneBitShift(data[15], 0, 2, 255, 0)],
        chargerDetection: bitShift(data[15], 3),
        overTempWarning: bitShift(data[15], 4),
        fault: FaultArray[byteArrayToUnsignedInt1(data[16])],
      };
    } else if (hex2 === "f6") {
      patch.parallel = {
        type: "cellMinMax",
        batteryPackId: byteArrayToUnsignedInt2([data[11], data[12]]),
        maxCellVoltage: byteArrayToUnsignedInt2([data[9], data[10]]),
        maxCellVoltageNum: byteArrayToUnsignedInt1(data[13]),
        minCellVoltage: byteArrayToUnsignedInt2([data[14], data[15]]),
        minCellVoltageNum: byteArrayToUnsignedInt1(data[16]),
      };
    }
  }

  switch (canValue) {
    case CAN_ID.HEARTBEAT: {
      patch.batteryVoltage = byteArrayToUnsignedInt2([data[9], data[10]]) / 100;
      patch.current = byteArrayToInt2([data[11], data[12]]) / 100;
      patch.avrgCellTemp = byteArrayToInt1(data[13]);
      patch.soc = byteArrayToInt1(data[15]);
      patch.disFET = bitShift(data[16], 7);
      patch.chgFET = bitShift(data[16], 6);
      patch.battLow = bitShift(data[16], 5);
      patch.battHigh = bitShift(data[16], 4);
      patch.cellHigh = bitShift(data[16], 3);
      patch.cellLow = bitShift(data[16], 2);
      patch.ignS = bitShift(data[16], 1);
      patch.fullChargeBit = bitShift(data[16], 0);
      break;
    }
    case CAN_ID.HEARTBEAT_ALT: {
      patch.batteryVoltage = byteArrayToUnsignedInt2([data[9], data[10]]) / 10;
      patch.current = byteArrayToInt2([data[11], data[12]]) / 10;
      patch.avrgCellTemp = byteArrayToInt1(data[13]);
      patch.soc = byteArrayToUnsignedInt1(data[15]);
      patch.disFET = bitShift(data[16], 0);
      patch.chgFET = bitShift(data[16], 1);
      patch.battLow = bitShift(data[16], 2);
      patch.battHigh = bitShift(data[16], 3);
      patch.cellHigh = bitShift(data[16], 4);
      patch.ignS = bitShift(data[16], 5);
      patch.cellLow = bitShift(data[16], 6);
      patch.fullChargeBit = bitShift(data[16], 7);
      break;
    }
    case CAN_ID.CAPACITY_SOH: {
      patch.availableCapacity = byteArrayToUnsignedInt2([data[9], data[10]]) / 100;
      patch.cyclesCount = byteArrayToUnsignedInt2([data[11], data[12]]);
      patch.soh = byteArrayToUnsignedInt1(data[13]);
      patch.sop = byteArrayToUnsignedInt1(data[14]);
      patch.canChargerDetectionFlag = bitShift(data[15], 3);
      patch.lowSocIndication = bitShift(data[15], 4);
      patch.canLoginStatusFlag = bitShift(data[15], 5);
      patch.ignitionOverCanFlag = bitShift(data[15], 6);
      patch.balancingStatus = bitShift(data[15], 7);
      patch.pduTemp = byteArrayToInt1(data[16]);
      break;
    }
    case CAN_ID.CELL_MINMAX_TEMP: {
      patch.maxCellVolt = byteArrayToUnsignedInt2([data[9], data[10]]);
      patch.minCellVolt = byteArrayToUnsignedInt2([data[11], data[12]]);
      patch.maxCellTemp = byteArrayToInt1(data[13]);
      patch.minCellTemp = byteArrayToInt1(data[14]);
      patch.avrgCellVolt = byteArrayToUnsignedInt2([data[15], data[16]]);
      break;
    }
    case CAN_ID.CELL_VOLT_0: {
      patch.numberOfCell = data[9];
      patch.showUiFor24SPlus = false;
      const cellVoltageArray = state.cellVoltageArray.slice();
      cellVoltageArray[0] = byteArrayToInt2([data[10], data[11]]);
      cellVoltageArray[1] = byteArrayToInt2([data[12], data[13]]);
      cellVoltageArray[2] = byteArrayToInt2([data[14], data[15]]);
      patch.cellVoltageArray = cellVoltageArray;
      break;
    }
    case CAN_ID.CELL_VOLT_1: {
      const arr = state.cellVoltageArray.slice();
      arr[3] = byteArrayToInt2([data[9], data[10]]);
      arr[4] = byteArrayToInt2([data[11], data[12]]);
      arr[5] = byteArrayToInt2([data[13], data[14]]);
      arr[6] = byteArrayToInt2([data[15], data[16]]);
      patch.cellVoltageArray = arr;
      break;
    }
    case CAN_ID.CELL_VOLT_2: {
      const arr = state.cellVoltageArray.slice();
      arr[7] = byteArrayToInt2([data[9], data[10]]);
      arr[8] = byteArrayToInt2([data[11], data[12]]);
      arr[9] = byteArrayToInt2([data[13], data[14]]);
      arr[10] = byteArrayToInt2([data[15], data[16]]);
      patch.cellVoltageArray = arr;
      break;
    }
    case CAN_ID.CELL_VOLT_3: {
      const arr = state.cellVoltageArray.slice();
      arr[11] = byteArrayToInt2([data[9], data[10]]);
      arr[12] = byteArrayToInt2([data[11], data[12]]);
      arr[13] = byteArrayToInt2([data[13], data[14]]);
      arr[14] = byteArrayToInt2([data[15], data[16]]);
      patch.cellVoltageArray = arr;
      break;
    }
    case CAN_ID.CELL_VOLT_4: {
      const arr = state.cellVoltageArray.slice();
      arr[15] = byteArrayToInt2([data[9], data[10]]);
      arr[16] = byteArrayToInt2([data[11], data[12]]);
      arr[17] = byteArrayToInt2([data[13], data[14]]);
      arr[18] = byteArrayToInt2([data[15], data[16]]);
      patch.cellVoltageArray = arr;
      break;
    }
    case CAN_ID.CELL_VOLT_5: {
      const arr = state.cellVoltageArray.slice();
      arr[19] = byteArrayToInt2([data[9], data[10]]);
      arr[20] = byteArrayToInt2([data[11], data[12]]);
      arr[21] = byteArrayToInt2([data[13], data[14]]);
      arr[22] = byteArrayToInt2([data[15], data[16]]);
      patch.cellVoltageArray = arr;
      break;
    }
    case CAN_ID.CELL_VOLT_6: {
      const arr = state.cellVoltageArray.slice();
      arr[23] = byteArrayToInt2([data[9], data[10]]);
      patch.cellVoltageArray = arr;
      break;
    }
    case CAN_ID.TEMP_0: {
      patch.numOfTemp = data[9];
      const temps = [
        byteArrayToInt1(data[10]),
        byteArrayToInt1(data[11]),
        byteArrayToInt1(data[12]),
        byteArrayToInt1(data[13]),
        byteArrayToInt1(data[14]),
        byteArrayToInt1(data[15]),
        byteArrayToInt1(data[16]),
      ];
      patch.cellTemperatureArray = temps.concat(state.cellTemperatureArray.slice(7));
      break;
    }
    case CAN_ID.TEMP_1: {
      const temps = state.cellTemperatureArray.slice();
      temps[7] = byteArrayToInt1(data[9]);
      patch.cellTemperatureArray = temps;
      patch.icTemperatureArray = [byteArrayToInt1(data[10]), byteArrayToInt1(data[11])];
      patch.pduTemperatureArray = [byteArrayToInt1(data[12]), byteArrayToInt1(data[13])];
      patch.heatSinkTemperatureArray = [byteArrayToInt1(data[14]), byteArrayToInt1(data[15])];
      break;
    }
    case CAN_ID.BMS_STATES: {
      patch.bmsPowerMode = data[9];
      patch.packCurrentState = data[10];
      patch.alarm = data[11];
      patch.fault = data[12];
      patch.averageTimeToEmpty = byteArrayToInt2([data[13], data[14]]);
      patch.averageTimeToFull = byteArrayToInt2([data[15], data[16]]);
      break;
    }
    case CAN_ID.BATTERY_SERIAL: {
      const chars = [data[9], data[10], data[11], data[12]];
      patch.batterySerialArray = textDecode(chars);
      patch.batterySerialInt = byteArrayToInt4([data[13], data[14], data[15], data[16]]);
      break;
    }
    case CAN_ID.WARNING_FLAGS: {
      const flags = [];
      flags.push(moreThanOneBitShift(data[9], 2, 3, 255, 255));
      flags.push(moreThanOneBitShift(data[9], 4, 5, 255, 255));
      flags.push(moreThanOneBitShift(data[9], 6, 7, 255, 255));
      flags.push(moreThanOneBitShift(data[10], 0, 1, 255, 255));
      flags.push(moreThanOneBitShift(data[10], 2, 3, 255, 255));
      flags.push(moreThanOneBitShift(data[10], 4, 5, 255, 255));
      flags.push(moreThanOneBitShift(data[10], 6, 7, 255, 255));
      flags.push(moreThanOneBitShift(data[11], 0, 1, 255, 255));
      flags.push(moreThanOneBitShift(data[11], 2, 3, 255, 255));
      flags.push(moreThanOneBitShift(data[11], 4, 5, 255, 255));
      flags.push(moreThanOneBitShift(data[11], 6, 7, 255, 255));
      flags.push(moreThanOneBitShift(data[12], 0, 1, 255, 255));
      flags.push(moreThanOneBitShift(data[12], 2, 3, 255, 255));
      flags.push(moreThanOneBitShift(data[12], 4, 5, 255, 255));
      flags.push(moreThanOneBitShift(data[12], 6, 7, 255, 255));
      flags.push(moreThanOneBitShift(data[13], 0, 1, 255, 255));
      flags.push(moreThanOneBitShift(data[13], 2, 3, 255, 255));
      patch.warningFlagsArray = flags;
      break;
    }
    case CAN_ID.ENERGY: {
      patch.energyOut = byteArrayToInt4([data[9], data[10], data[11], data[12]]);
      patch.energyIn = byteArrayToInt4([data[13], data[14], data[15], data[16]]);
      break;
    }
    case CAN_ID.TIMESTAMP: {
      patch.year = data[9];
      patch.month = data[10];
      patch.day = data[11];
      patch.hour = data[12];
      patch.minutes = data[13];
      patch.seconds = data[14];
      break;
    }
    case CAN_ID.BMS_MODEL_ID: {
      patch.bmsModelId = textDecode([data[9], data[10], data[11], data[12], data[13], data[14], data[15]]);
      break;
    }
    case CAN_ID.BMS_CONFIG_VERSION: {
      patch.bmsConfigVersionCrc16 = data[9];
      break;
    }
    case CAN_ID.PDU_HW_VERSION: {
      patch.pduHardwareVersion = textDecode([
        data[9], data[10], data[11], data[12], data[13], data[14], data[15], data[16],
      ]);
      break;
    }
    case CAN_ID.BMS_HW_VERSION: {
      patch.bmsHardwareVersion = textDecode([
        data[9], data[10], data[11], data[12], data[13], data[14], data[15], data[16],
      ]);
      break;
    }
    case CAN_ID.BMS_FW_VERSION: {
      patch.firmwareVersion = textDecode([
        data[9], data[10], data[11], data[12], data[13], data[14], data[15], data[16],
      ]);
      break;
    }
    case CAN_ID.PIN_STATES: {
      patch.pins = {
        devOnOff: bitShift(data[9], 0),
        islGlobalFault: bitShift(data[9], 1),
        islGlobalEn: bitShift(data[9], 2),
        bmsIgnition: bitShift(data[9], 3),
        dMosfets: bitShift(data[9], 4),
        cMosfets: bitShift(data[9], 5),
        pchgFET: bitShift(data[9], 6),
        scdAlert: bitShift(data[9], 7),
        v5OnOff: bitShift(data[10], 0),
        statusPin: bitShift(data[10], 1),
        powerGoodPin: bitShift(data[10], 2),
        loadDetectionPin: bitShift(data[10], 3),
        chargerDetectionPin: bitShift(data[10], 4),
        chargerDetection1Pin: bitShift(data[10], 5),
        relay1Pin: bitShift(data[10], 6),
        relay2Pin: bitShift(data[10], 7),
        clpgPin: bitShift(data[11], 0),
        clfEnPin: bitShift(data[11], 1),
        glvbEnPin: bitShift(data[11], 2),
        clEnPin: bitShift(data[11], 3),
        alert1: bitShift(data[11], 4),
        v33OnOff: bitShift(data[11], 5),
        driverPower: bitShift(data[11], 6),
        ledPower: bitShift(data[11], 7),
        displayEn: bitShift(data[12], 0),
        chargerReverse: bitShift(data[12], 1),
      };
      break;
    }
    case CAN_ID.CELL_BALANCING: {
      patch.cellBalancing = decodeCellBalancing(data, state);
      break;
    }
    case CAN_ID.BATTERY_PACK_ID: {
      const chars = [data[10], data[11], data[12], data[13], data[14], data[15], data[16]];
      if (data[9] === 0) patch.batteryPackId1 = textDecode(chars);
      else if (data[9] === 1) patch.batteryPackId2 = textDecode(chars);
      break;
    }
    case CAN_ID.CONFIG_ARRAY: {
      const bytes = [data[10], data[11], data[12], data[13], data[14], data[15], data[16]];
      const buffer = state.configBuffer.concat(bytes);
      patch.configBuffer = buffer;
      if (window.__CONFIG_FETCH_ACTIVE__) {
        console.log(`[config-fetch] frame #${buffer.length / 7}, total bytes so far: ${buffer.length}/161`);
      }
      if (buffer.length >= 161) {
        if (window.__CONFIG_FETCH_ACTIVE__) {
          console.log("[config-fetch] COMPLETE - full 161-byte buffer:", buffer.slice(0, 161));
        }
        patch.configValues = decodeConfigArray(buffer.slice(0, 161), deviceType);
        patch.configFetchComplete = true;
      }
      break;
    }
    case CAN_ID.CELLS_24S_META: {
      patch.bmsNoOfCellAvailable = data[9];
      patch.bmsNoOfTempAvailable = data[10];
      patch.bmsNoOfExterTempAvailable = data[11];
      patch.showUiFor24SPlus = true;
      patch.numberOfCell = data[9];
      break;
    }
    case CAN_ID.CELLS_24S_DATA: {
      const idx = data[9];
      const arr = state.cellVoltageFor24SPlus.slice();
      arr[idx] = (getBitValueFor24PlusS(data[11], 0, 4) << 8) | data[10];
      arr[idx + 1] =
        getBitValueFor24PlusS(data[11], 5, 7) | (data[12] << 3) | (getBitValueFor24PlusS(data[13], 0, 1) << 11);
      arr[idx + 2] = getBitValueFor24PlusS(data[13], 2, 7) | (data[14] << 6);
      arr[idx + 3] = (getBitValueFor24PlusS(data[16], 0, 4) << 8) | data[15];
      patch.cellVoltageFor24SPlus = arr;
      break;
    }
    case CAN_ID.TEMP_24S_DATA: {
      const idx = data[9];
      const arr = state.cellTempFor24SPlus.slice();
      arr[idx] = byteArrayToInt2([data[11], data[12]]) / 10;
      arr[idx + 1] = byteArrayToInt2([data[13], data[14]]) / 10;
      arr[idx + 2] = byteArrayToInt2([data[15], data[16]]) / 10;
      patch.cellTempFor24SPlus = arr;
      break;
    }
    case CAN_ID.EXTR_TEMP_24S_DATA: {
      const idx = data[9];
      const arr = state.extrTempFor24SPlus.slice();
      arr[idx] = byteArrayToInt2([data[11], data[12]]) / 10;
      arr[idx + 1] = byteArrayToInt2([data[13], data[14]]) / 10;
      arr[idx + 2] = byteArrayToInt2([data[15], data[16]]) / 10;
      patch.extrTempFor24SPlus = arr;
      break;
    }
    case BMU_TOOL_ID: {
      // Only the addressing command has a response; [1, addrIn, addrOut].
      if (data[9] === BMU_TOOL_CMD.ADDRESSING) {
        patch.bmuAddressIn = data[10];
        patch.bmuAddressOut = data[11];
        patch.bmuAddressAt = Date.now();
      }
      break;
    }
    default:
      break;
  }

  patch._lastCanValue = canValue;
  patch._lastFrameAt = Date.now();
  return patch;
}

/**
 * cellBalancingDataRecd() ported from UpdateUI.js. Bitmap is 6 bytes
 * (bytes[11..16] of the 21-byte frame == data[2..7] of the 8-byte CAN payload),
 * LSB-first, 48 cells per packet (CELLS_PER_BALANCING_PACKET).
 */
function decodeCellBalancing(packet, state) {
  const BITMAP_BYTES = 6;
  const CELLS_PER_PACKET = BITMAP_BYTES * 8;
  const numberOfCells = packet[9];
  const packetIndex = packet[10];
  const bitmapBytes = packet.slice(11, 11 + BITMAP_BYTES);
  const totalPackets = Math.ceil(numberOfCells / CELLS_PER_PACKET);

  if (packetIndex >= totalPackets) return state.cellBalancing;

  let { array, length, received } = state.cellBalancing || { array: null, length: null, received: new Set() };
  if (!array || length !== numberOfCells || (packetIndex === 0 && received.size === totalPackets)) {
    length = numberOfCells;
    array = new Array(numberOfCells).fill(0);
    received = new Set();
  } else {
    array = array.slice();
    received = new Set(received);
  }

  const startCellIndex = packetIndex * CELLS_PER_PACKET;
  bitmapBytes.forEach((byte, byteIdx) => {
    for (let bit = 0; bit < 8; bit++) {
      const cellIndex = startCellIndex + byteIdx * 8 + bit;
      if (cellIndex < numberOfCells) array[cellIndex] = (byte >> bit) & 0x01;
    }
  });
  received.add(packetIndex);

  return { array, length, received, complete: received.size === totalPackets };
}

/** Initial live-data state shape, mirrors globals declared across renderer.js/UpdateUI.js. */
export function createInitialLiveState() {
  return {
    batteryVoltage: 0,
    current: 0,
    soc: 0,
    avrgCellTemp: 0,
    avrgCellVolt: 0,
    disFET: 0,
    chgFET: 0,
    battLow: 0,
    battHigh: 0,
    cellHigh: 0,
    cellLow: 0,
    ignS: 0,
    fullChargeBit: 0,
    availableCapacity: 0,
    cyclesCount: 0,
    soh: 0,
    sop: 0,
    maxCellVolt: 0,
    minCellVolt: 0,
    maxCellTemp: 0,
    minCellTemp: 0,
    numberOfCell: 0,
    numOfTemp: 0,
    cellVoltageArray: new Array(24).fill(0),
    cellTemperatureArray: new Array(8).fill(0),
    icTemperatureArray: [0, 0],
    pduTemperatureArray: [0, 0],
    heatSinkTemperatureArray: [0, 0],
    bmsPowerMode: 0,
    packCurrentState: 0,
    alarm: 0,
    fault: 0,
    averageTimeToEmpty: 0,
    averageTimeToFull: 0,
    batterySerialArray: "",
    batterySerialInt: 0,
    warningFlagsArray: [],
    energyOut: 0,
    energyIn: 0,
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minutes: 0,
    seconds: 0,
    bmsModelId: "",
    bmsConfigVersionCrc16: 0,
    pduHardwareVersion: "",
    bmsHardwareVersion: "",
    firmwareVersion: "",
    pins: {},
    cellBalancing: { array: null, length: null, received: new Set(), complete: false },
    batteryPackId1: "",
    batteryPackId2: "",
    configBuffer: [],
    configValues: null,
    configFetchComplete: false,
    showUiFor24SPlus: false,
    bmsNoOfCellAvailable: 0,
    bmsNoOfTempAvailable: 0,
    bmsNoOfExterTempAvailable: 0,
    cellVoltageFor24SPlus: new Array(96).fill(0),
    cellTempFor24SPlus: new Array(32).fill(0),
    extrTempFor24SPlus: new Array(32).fill(0),
    parallel: null,
    bmuAddressIn: null,
    bmuAddressOut: null,
    bmuAddressAt: 0,
    _lastCanValue: null,
    _lastFrameAt: 0,
  };
}

/**
 * Packs with more than 24 cells (and some RBMS/BMU firmware regardless of
 * count) report cells via CELLS_24S_META / CELLS_24S_DATA / TEMP_24S_DATA
 * instead of the fixed CELL_VOLT_0..6 / TEMP_0..1 frames, and the decoder
 * stores those in separate *For24SPlus arrays. Pages should read cells through
 * this selector so either layout ends up on screen.
 */
export function selectCellArrays(liveData) {
  if (liveData.showUiFor24SPlus) {
    const cellCount = liveData.bmsNoOfCellAvailable || liveData.numberOfCell || 0;
    const tempCount = liveData.bmsNoOfTempAvailable || 0;
    return {
      cellVoltages: liveData.cellVoltageFor24SPlus.slice(0, cellCount),
      cellTemps: liveData.cellTempFor24SPlus.slice(0, tempCount),
    };
  }
  const { cellVoltageArray, cellTemperatureArray, numberOfCell, numOfTemp } = liveData;
  return {
    cellVoltages: cellVoltageArray.slice(0, numberOfCell || cellVoltageArray.length),
    cellTemps: cellTemperatureArray.slice(0, numOfTemp || cellTemperatureArray.length),
  };
}
