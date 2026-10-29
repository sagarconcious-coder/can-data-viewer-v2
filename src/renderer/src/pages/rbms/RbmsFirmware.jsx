import React, { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../lib/toast.jsx";
import {
  chunkFirmwareFile,
  sendXmodemPacket,
  startFirmwareUpdate,
  interpretBootloaderResponse,
  sendXmodemControl,
  sendXmodemEot,
} from "../../lib/firmwareUpdate.js";
import protocol from "../../../../shared/protocol.js";

const { CAN_ID } = protocol;

export default function RbmsFirmware({ connection }) {
  const [fileName, setFileName] = useState("");
  const [fileValidated, setFileValidated] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [percentage, setPercentage] = useState("");
  const showToast = useToast();

  const chunksRef = useRef({ chunks: [], packetNumbers: [] });
  const incrementRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = window.canApi.onData((frame) => {
      const canId = [frame[7], frame[6], frame[5], frame[4]];
      const canValue = ((canId[0] << 24) | (canId[1] << 16) | (canId[2] << 8) | canId[3]) >>> 0;
      if (canValue !== CAN_ID.BOOTLOADER_RX) return;
      handleBootloaderFrame(frame[9], frame[10]);
    });
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBootloaderFrame = async (cmd1, cmd2) => {
    const result = interpretBootloaderResponse(cmd1, cmd2);
    setStatus(result.status);

    if (result.action === "send-control") {
      if (result.value === 0x33 && !fileValidated) {
        setStatus("No compatible file found, please upload a correct .bin file to continue");
        return;
      }
      await sendXmodemControl(result.value);
    } else if (result.action === "xmodem-send") {
      incrementRef.current = 0;
      stoppedRef.current = false;
      await sendXmodemPacket(chunksRef.current.chunks, chunksRef.current.packetNumbers, incrementRef.current);
    } else if (result.action === "xmodem-ack") {
      const total = chunksRef.current.chunks.length;
      if (incrementRef.current < total - 1) {
        setPercentage(`${Math.ceil((incrementRef.current / total) * 100)}%`);
        incrementRef.current += 1;
        await sendXmodemPacket(chunksRef.current.chunks, chunksRef.current.packetNumbers, incrementRef.current);
      } else if (!stoppedRef.current) {
        setStatus("Finalizing upload");
        await sendXmodemEot();
        stoppedRef.current = true;
      }
    } else if (result.action === "xmodem-nack") {
      if (fileValidated) await sendXmodemPacket(chunksRef.current.chunks, chunksRef.current.packetNumbers, incrementRef.current);
    } else if (result.action === "done") {
      setPercentage("100%");
      showToast("Firmware update complete", "success");
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bytes = new Uint8Array(evt.target.result);
      chunksRef.current = chunkFirmwareFile(bytes);
      setFileValidated(true);
      setStatus(
        bytes.length === 122496
          ? "Ready, proceed for firmware update!"
          : "File size differs from the legacy 122496-byte image, proceeding anyway",
      );
    };
    reader.readAsArrayBuffer(file);
  };

  const handleUpdate = async () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return;
    }
    if (!fileValidated) {
      showToast("Select a firmware .bin file first", "failure");
      return;
    }
    setStatus("Initiating Firmware Update");
    setPercentage("");
    await startFirmwareUpdate();
  };

  return (
    <div className="page-container">
      <PageHeader
        title="RBMS Firmware Update"
        subtitle="Local xModem-over-CAN firmware flashing. No backend/license server involved — you supply the .bin file directly."
      />

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Connect to a serial port before starting a firmware update.</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Firmware File</div>
        <div className="grid grid-2" style={{ alignItems: "end" }}>
          <div className="field">
            <label>Select .bin file</label>
            <input type="file" accept=".bin" onChange={handleFileChange} />
            {fileName && <span className="field-hint">{fileName}</span>}
          </div>
          <button className="btn btn-primary" onClick={handleUpdate} disabled={!fileValidated || !connection.status.connected}>
            Start Firmware Update
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Update Status</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{status}</div>
          {percentage && (
            <div style={{ background: "var(--bg-sunken)", borderRadius: 8, height: 10, overflow: "hidden" }}>
              <div
                style={{
                  width: percentage,
                  background: "var(--bms-accent)",
                  height: "100%",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          )}
          {percentage && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{percentage}</div>}
        </div>
      </div>
    </div>
  );
}
