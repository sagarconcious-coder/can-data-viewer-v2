import protocol from "../../../shared/protocol.js";

// Inverted CAN_ID map (decimal id -> symbolic name), built once. protocol.js
// defines several aliases pointing at the same numeric id (e.g. LOGIN_TX and
// LOGIN_RX are both 512496471) - first key wins, which matches insertion
// order in CAN_ID and is good enough for a display label.
const ID_TO_NAME = (() => {
  const map = new Map();
  for (const [name, value] of Object.entries(protocol.CAN_ID)) {
    if (typeof value !== "number") continue;
    if (!map.has(value)) map.set(value, name);
  }
  return map;
})();

/** Best-effort friendly name for a decimal CAN id, or null if unrecognized. */
export function lookupCanIdName(idDecimal) {
  return ID_TO_NAME.get(idDecimal) ?? null;
}
