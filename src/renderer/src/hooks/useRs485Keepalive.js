import { useEffect } from "react";
import { sendRs485Keepalive } from "../lib/canCommands.js";

/**
 * Ports rs485StartInterval()/rs485StopInterval() from renderer.js: while
 * connected over RS485, sends a keepalive poll every 1s so the device
 * doesn't go idle/stop responding. Paused during firmware update (matching
 * the old app's `firmware-tab` check), since the bootloader handshake owns
 * the link exclusively at that point and an interleaved keepalive frame
 * would corrupt it.
 */
export function useRs485Keepalive({ enabled, connected, isFirmwareRoute }) {
  useEffect(() => {
    if (!enabled || !connected || isFirmwareRoute) return undefined;
    const interval = setInterval(() => {
      sendRs485Keepalive().catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, [enabled, connected, isFirmwareRoute]);
}
