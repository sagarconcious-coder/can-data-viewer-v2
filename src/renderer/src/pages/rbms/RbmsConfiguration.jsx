import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../lib/toast.jsx";
import { useRbmsProtocol } from "../../lib/useRbmsProtocol.js";

export default function RbmsConfiguration({ connection }) {
  const showToast = useToast();
  const { rbmsData, setRbmsData, fetching, fetchRbms, sendBmuConfig, sendModelId, sendUuid, sendInverterConfig, sendEthernetConfig } =
    useRbmsProtocol(showToast);

  const requireConnection = () => {
    if (!connection.status.connected) {
      showToast("Serial port not connected", "failure");
      return false;
    }
    return true;
  };

  const handleFetch = () => {
    if (!requireConnection()) return;
    fetchRbms();
  };

  const handleSendBmu = async () => {
    if (!requireConnection()) return;
    const noBmu = parseInt(rbmsData.noBmu, 10);
    const sPerBmu = parseInt(rbmsData.sPerBmu, 10);
    const tempPerBmu = parseInt(rbmsData.tempPerBmu, 10);
    if (isNaN(noBmu) || isNaN(sPerBmu) || isNaN(tempPerBmu)) {
      showToast("No of BMU, S per BMU and Temp per BMU are required", "failure");
      return;
    }
    await sendBmuConfig(noBmu, sPerBmu, tempPerBmu);
    showToast("BMU configuration sent", "success");
  };

  const handleSendModelId = async () => {
    if (!requireConnection()) return;
    if (!rbmsData.modelId.trim()) {
      showToast("Model ID is required", "failure");
      return;
    }
    if (rbmsData.modelId.length > 18) {
      showToast("Model ID too long (max 18 chars)", "failure");
      return;
    }
    await sendModelId(rbmsData.modelId.trim());
    showToast("Model ID sent", "success");
  };

  const handleSendUuid = async () => {
    if (!requireConnection()) return;
    if (!rbmsData.uuid.trim()) {
      showToast("UUID is required", "failure");
      return;
    }
    await sendUuid(rbmsData.uuid.trim());
    showToast("UUID sent", "success");
  };

  const handleSendInverter = async () => {
    if (!requireConnection()) return;
    await sendInverterConfig(rbmsData);
    showToast("Inverter configuration sent", "success");
  };

  const handleSendFeatures = async () => {
    if (!requireConnection()) return;
    await sendEthernetConfig(rbmsData);
    showToast("RBMS features sent", "success");
  };

  const set = (key) => (e) => setRbmsData((prev) => ({ ...prev, [key]: e.target.value }));
  const isCan = rbmsData.invCommType === "CAN";

  return (
    <div className="page-container">
      <PageHeader
        title="RBMS Configuration"
        subtitle="BMU count, model ID, UUID, inverter comm settings and onboard features."
        right={
          <button className="btn btn-primary" onClick={handleFetch} disabled={fetching || !connection.status.connected}>
            {fetching ? "Fetching…" : "Fetch RBMS Data"}
          </button>
        }
      />

      {!connection.status.connected && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>⚠ Connect to a serial port before fetching or sending configuration.</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">BMU Configuration</div>
        <div className="grid grid-3">
          <div className="field">
            <label>No of BMU</label>
            <input type="number" value={rbmsData.noBmu} onChange={set("noBmu")} />
          </div>
          <div className="field">
            <label>Series per BMU</label>
            <input type="number" value={rbmsData.sPerBmu} onChange={set("sPerBmu")} />
          </div>
          <div className="field">
            <label>Temp per BMU</label>
            <input type="number" value={rbmsData.tempPerBmu} onChange={set("tempPerBmu")} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={handleSendBmu}>
            Send BMU Config
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Model ID</div>
          <div className="field">
            <label>Model ID (max 18 chars)</label>
            <input value={rbmsData.modelId} onChange={set("modelId")} maxLength={18} />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={handleSendModelId}>
              Send Model ID
            </button>
          </div>
        </div>
        <div className="card">
          <div className="card-title">UUID</div>
          <div className="field">
            <label>UUID</label>
            <input value={rbmsData.uuid} onChange={set("uuid")} />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={handleSendUuid}>
              Send UUID
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Inverter Communication</div>
        <div className="grid grid-3">
          <div className="field">
            <label>Protocol Available?</label>
            <select
              value={rbmsData.invProtocolAvail ? "yes" : "no"}
              onChange={(e) => setRbmsData((prev) => ({ ...prev, invProtocolAvail: e.target.value === "yes" }))}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
          {rbmsData.invProtocolAvail && (
            <div className="field">
              <label>Comm Type</label>
              <select value={rbmsData.invCommType} onChange={set("invCommType")}>
                <option value="CAN">CAN</option>
                <option value="RS485">RS485</option>
              </select>
            </div>
          )}
        </div>

        {rbmsData.invProtocolAvail && (
          <div className="grid grid-4" style={{ marginTop: 14 }}>
            {isCan ? (
              <>
                <div className="field">
                  <label>CAN Protocol</label>
                  <input type="number" value={rbmsData.invCanProtocol} onChange={set("invCanProtocol")} />
                </div>
                <div className="field">
                  <label>Baud Rate (CAN)</label>
                  <select value={rbmsData.invBaudRate} onChange={set("invBaudRate")}>
                    <option value="">Select</option>
                    <option value="125">125</option>
                    <option value="250">250</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label>RS485 Protocol</label>
                  <input type="number" value={rbmsData.invRs485Protocol} onChange={set("invRs485Protocol")} />
                </div>
                <div className="field">
                  <label>Slave ID</label>
                  <input type="number" value={rbmsData.invSlaveId} onChange={set("invSlaveId")} />
                </div>
                <div className="field">
                  <label>Baud Rate (RS485)</label>
                  <input type="number" value={rbmsData.invBaudRate} onChange={set("invBaudRate")} />
                </div>
                <div className="field">
                  <label>Parity</label>
                  <select value={rbmsData.invParity} onChange={set("invParity")}>
                    <option value="">Select</option>
                    <option value="0">None</option>
                    <option value="1">Even</option>
                    <option value="2">Odd</option>
                  </select>
                </div>
                <div className="field">
                  <label>Data Bit</label>
                  <input type="number" value={rbmsData.invDataBit} onChange={set("invDataBit")} />
                </div>
                <div className="field">
                  <label>Stop Bit</label>
                  <input type="number" value={rbmsData.invStopBit} onChange={set("invStopBit")} />
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={handleSendInverter}>
            Send Inverter Config
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Onboard Features</div>
        <div className="grid grid-3">
          <ToggleField label="SD Card" value={rbmsData.sdCardEnabled} onChange={(v) => setRbmsData((prev) => ({ ...prev, sdCardEnabled: v }))} />
          <ToggleField label="HMI" value={rbmsData.hmiEnabled} onChange={(v) => setRbmsData((prev) => ({ ...prev, hmiEnabled: v }))} />
          <ToggleField label="Ethernet" value={rbmsData.ethernetEnabled} onChange={(v) => setRbmsData((prev) => ({ ...prev, ethernetEnabled: v }))} />
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={handleSendFeatures}>
            Send Features
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleField({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value ? "on" : "off"} onChange={(e) => onChange(e.target.value === "on")}>
        <option value="off">Off</option>
        <option value="on">On</option>
      </select>
    </div>
  );
}
