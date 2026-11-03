// Use the runtime's IANA list; retain a complete list for older browsers that
// support time-zone formatting but do not expose Intl.supportedValuesOf.
import fallback from "./time-zone-fallback.json";

export const TIME_ZONES = [
  ...new Set([
    "UTC",
    ...(typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : fallback.filter(validTimeZone)),
  ]),
].sort();

export function validTimeZone(value) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function timeZoneLabel(value) {
  return value.replaceAll("_", " ").replaceAll("/", " / ");
}
