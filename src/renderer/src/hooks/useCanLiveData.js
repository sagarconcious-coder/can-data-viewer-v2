import { useEffect, useState, useCallback } from "react";
import { decodeFrame, createInitialLiveState } from "../lib/canDecoder.js";
import protocol from "../../../shared/protocol.js";

const STALE_TIMEOUT_MS = 5000;

/**
 * Subscribes to serial:data frames from the main process and maintains the
 * decoded live-CAN-data state, mirroring UpdateUI.js's dataStatus concept
 * (Live vs "Not Live, Last Updated: ...").
 */
export function useCanLiveData(deviceType) {
  const [liveData, setLiveData] = useState(createInitialLiveState);
  const [dataStatus, setDataStatus] = useState({ live: false, lastUpdate: null });

  useEffect(() => {
    const unsubscribe = window.canApi.onData((frame) => {
      if (window.__CONFIG_FETCH_ACTIVE__ && frame.length === 21) {
        const canValue = ((frame[7] << 24) | (frame[6] << 16) | (frame[5] << 8) | frame[4]) >>> 0;
        if (canValue !== protocol.CAN_ID.CONFIG_ARRAY) {
          console.log("[config-fetch] interleaved non-config frame, canId:", canValue);
        }
      }
      // Frames can arrive faster than React re-renders between them (e.g. a
      // burst of CONFIG_ARRAY packets). Computing the patch off a `prev`
      // snapshot captured outside this updater (a ref updated only on
      // render) meant two frames handled before the next render both read
      // the same stale configBuffer and each appended to it independently;
      // whichever setLiveData call committed last silently discarded the
      // other frame's 7 bytes, corrupting the config fetch non-deterministically.
      // Decoding inside the updater guarantees `prev` is always the latest
      // state, even across back-to-back frames in the same tick.
      setLiveData((prev) => {
        const patch = decodeFrame(frame, prev, deviceType);
        return { ...prev, ...patch };
      });
      setDataStatus({ live: true, lastUpdate: Date.now() });
    });
    return unsubscribe;
  }, [deviceType]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDataStatus((prev) => {
        if (prev.lastUpdate && Date.now() - prev.lastUpdate > STALE_TIMEOUT_MS) {
          return { ...prev, live: false };
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const resetConfigBuffer = useCallback(() => {
    setLiveData((prev) => ({ ...prev, configBuffer: [], configValues: null, configFetchComplete: false }));
  }, []);

  // Clears every decoded value back to its initial state (e.g. BMU Data's
  // Start Data, so the page only shows values received after the restart).
  const resetLiveData = useCallback(() => {
    setLiveData(createInitialLiveState());
  }, []);

  return { liveData, dataStatus, resetConfigBuffer, resetLiveData };
}
