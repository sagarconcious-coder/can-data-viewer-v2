import { useEffect, useRef, useState } from "react";
import protocol from "../../../shared/protocol.js";
import { sendCanLogin, sendCommand, sleep } from "./canCommands.js";

const { CAN_ID, integerTo4ByteArray } = protocol;

const CAN_TX_ID_CONFIG = 512496492;
export const RBMS_COMMAND_TYPES = { BMU_CONFIG: 2, MODEL_ID: 4, UUID: 5, INVERTER_CONFIG: 6, RBMS_FEATURES: 7 };

const BAUD_CAN_MAP = { 1: 125, 2: 250, 3: 500, 4: 1000 };
const BAUD_RS485_MAP = { 1: 1200, 2: 2400, 3: 4800, 4: 9600, 5: 14400, 6: 19200, 7: 28800, 8: 38400, 9: 56000, 10: 57600, 11: 115200 };

function stringTo6ByteChunks(str) {
  const chunks = [];
  for (let i = 0; i < Math.ceil(str.length / 6); i++) {
    const chunk = str.substr(i * 6, 6).padEnd(6, "\0");
    chunks.push(chunk.split("").map((c) => c.charCodeAt(0)));
  }
  return chunks;
}

/**
 * Faithful port of js/RBMSConfig.js's fetch/parse/timeout state machine
 * (rbmsConfigurationDataReceived(), startRbmsFetchTimer()/completeRbmsFetch()),
 * adapted to React state instead of DOM element bindings.
 */
export function useRbmsProtocol(showToast) {
  const [rbmsData, setRbmsData] = useState({
    noBmu: "", sPerBmu: "", tempPerBmu: "", modelId: "", uuid: "",
    invCommType: "", invProtocolAvail: false, invCanProtocol: "", invRs485Protocol: "",
    invBaudRate: "", invSlaveId: "", invParity: "", invDataBit: "", invStopBit: "",
    sdCardEnabled: false, hmiEnabled: false, ethernetEnabled: false,
  });
  const [fetching, setFetching] = useState(false);
  const modelIdRef = useRef("");
  const uuidRef = useRef("");
  const timeoutRef = useRef(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = window.canApi.onData((frame) => {
      const canId = [frame[7], frame[6], frame[5], frame[4]];
      const canValue = ((canId[0] << 24) | (canId[1] << 16) | (canId[2] << 8) | canId[3]) >>> 0;
      if (canValue !== CAN_ID.RBMS_CONFIG_DATA) return;
      handleFrame(frame);
    });
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function completeFetch() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pendingRef.current) {
      pendingRef.current = false;
      setFetching(false);
      showToast("RBMS data fetched successfully", "success");
    }
  }

  function handleFrame(data) {
    switch (data[9]) {
      case 2: {
        setRbmsData((prev) => ({ ...prev, noBmu: data[11], sPerBmu: data[12], tempPerBmu: data[13] }));
        break;
      }
      case 4: {
        if (data[10] === 0) modelIdRef.current = "";
        modelIdRef.current += String.fromCharCode(data[11], data[12], data[13], data[14], data[15], data[16]).replace(/\0/g, "");
        if (data[10] >= 2) setRbmsData((prev) => ({ ...prev, modelId: modelIdRef.current.trim() }));
        break;
      }
      case 5: {
        if (data[10] === 0) uuidRef.current = "";
        uuidRef.current += String.fromCharCode(data[11], data[12], data[13], data[14], data[15], data[16]).replace(/\0/g, "");
        if (data[10] >= 3) setRbmsData((prev) => ({ ...prev, uuid: uuidRef.current.trim() }));
        break;
      }
      case 6: {
        const protocolAvail = data[11] === 1;
        setRbmsData((prev) => {
          const next = { ...prev, invProtocolAvail: protocolAvail };
          if (protocolAvail) {
            const commType = data[12];
            next.invCommType = commType === 0 ? "CAN" : "RS485";
            if (data[10] === 0) {
              if (commType === 0) {
                next.invCanProtocol = data[13];
                next.invBaudRate = BAUD_CAN_MAP[data[14]] || 0;
              } else {
                next.invRs485Protocol = data[13];
                next.invSlaveId = data[14];
                next.invBaudRate = BAUD_RS485_MAP[data[15]] || 0;
                next.invParity = data[16];
              }
            } else if (data[10] === 1) {
              next.invDataBit = data[13];
              next.invStopBit = data[14];
            }
          }
          return next;
        });
        break;
      }
      case 7: {
        setRbmsData((prev) => ({
          ...prev,
          sdCardEnabled: data[11] === 1,
          hmiEnabled: data[12] === 1,
          ethernetEnabled: data[13] === 1,
        }));
        break;
      }
      default:
        break;
    }
    if (data[9] === 7) completeFetch();
  }

  async function fetchRbms() {
    pendingRef.current = true;
    setFetching(true);
    showToast("Fetching RBMS data…", "info");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (pendingRef.current) {
        pendingRef.current = false;
        setFetching(false);
        showToast("RBMS fetch failed. Check serial wire/connection.", "failure");
      }
    }, 3000);
    await sendCanLogin();
    await sleep(10);
    await sendCommand(CAN_ID.CMD_TX, 1, [0x41, 0x44, 0x54, 0x26, 0x44, 0x00, 0x00, 0x00]);
  }

  async function sendBmuConfig(noBmu, sPerBmu, tempPerBmu) {
    await sendCommand(CAN_TX_ID_CONFIG, 1, [RBMS_COMMAND_TYPES.BMU_CONFIG, 0, noBmu, sPerBmu, tempPerBmu, 0, 0, 0]);
  }

  async function sendStringInChunks(commandType, str, totalChunks) {
    let chunks = stringTo6ByteChunks(str || "");
    while (chunks.length < totalChunks) chunks.push([0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = chunks[i] || [0, 0, 0, 0, 0, 0];
      await sendCommand(CAN_TX_ID_CONFIG, 1, [commandType, i, ...chunk]);
      await sleep(50);
    }
  }

  async function sendModelId(modelId) {
    await sendStringInChunks(RBMS_COMMAND_TYPES.MODEL_ID, modelId, 3);
  }
  async function sendUuid(uuid) {
    await sendStringInChunks(RBMS_COMMAND_TYPES.UUID, uuid, 4);
  }

  async function sendInverterConfig(cfg) {
    const isCan = cfg.invCommType === "CAN";
    const protocolAvail = cfg.invProtocolAvail ? 1 : 0;
    if (!protocolAvail) {
      await sendCommand(CAN_TX_ID_CONFIG, 1, [RBMS_COMMAND_TYPES.INVERTER_CONFIG, 0, 0, 0, 0, 0, 0, 0]);
      return;
    }
    const packet0 = [
      RBMS_COMMAND_TYPES.INVERTER_CONFIG, 0, protocolAvail, isCan ? 0 : 1,
      ...(isCan
        ? [Number(cfg.invCanProtocol) || 0, Number(cfg.invBaudRate) || 0, 0, 0]
        : [Number(cfg.invRs485Protocol) || 0, Number(cfg.invSlaveId) || 0, Number(cfg.invBaudRate) || 0, Number(cfg.invParity) || 0]),
    ];
    await sendCommand(CAN_TX_ID_CONFIG, 1, packet0);
    if (!isCan) {
      await sleep(50);
      await sendCommand(CAN_TX_ID_CONFIG, 1, [
        RBMS_COMMAND_TYPES.INVERTER_CONFIG, 1, protocolAvail, 1,
        Number(cfg.invDataBit) || 0, Number(cfg.invStopBit) || 0, 0, 0,
      ]);
    }
  }

  async function sendEthernetConfig(cfg) {
    await sendCommand(CAN_TX_ID_CONFIG, 1, [
      RBMS_COMMAND_TYPES.RBMS_FEATURES, 0,
      cfg.sdCardEnabled ? 1 : 0, cfg.hmiEnabled ? 1 : 0, cfg.ethernetEnabled ? 1 : 0, 0, 0, 0,
    ]);
  }

  return {
    rbmsData, setRbmsData, fetching,
    fetchRbms, sendBmuConfig, sendModelId, sendUuid, sendInverterConfig, sendEthernetConfig,
  };
}
