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

// Small, explicit location aliases, not a geocoder. Unknown places retain
// access to the complete registry rather than implying they have no time zone.
const LOCATION_ALIASES = {
  "America/Los_Angeles": "san diego california pacific time",
  "America/Chicago": "texas central time",
  "America/Denver": "texas el paso hudspeth mountain time",
};
function searchWords(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
export function searchTimeZones(query) {
  const words = searchWords(query);
  const matches = TIME_ZONES.filter((zone) => {
    const text = searchWords(zone + " " + (LOCATION_ALIASES[zone] || "")).join(
      " ",
    );
    return words.every((word) => text.includes(word));
  });
  const noMatches = words.length > 0 && matches.length === 0;
  return {
    matches,
    noMatches,
    options: noMatches ? TIME_ZONES : matches,
    note:
      words.includes("texas") && matches.length > 1
        ? "Texas spans Central (America / Chicago) and Mountain (America / Denver) time. Choose the zone for the visit location."
        : "",
  };
}
