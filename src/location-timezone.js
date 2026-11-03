import manifest from "./location-data-manifest.json";
import { validTimeZone } from "./time-zones.js";
export const LOCATION_DATA_VERSION = manifest.version;
export const normalizeLocation = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const countries = Object.entries(manifest.countries);
export function locationCountry(value) {
  const word = normalizeLocation(value);
  const aliases = {
    usa: "US",
    "u s a": "US",
    "u s": "US",
    uk: "GB",
    "united states of america": "US",
    "great britain": "GB",
  };
  return (
    (Object.hasOwn(aliases, word) ? aliases[word] : "") ||
    countries.find(([, c]) =>
      c.names.some((n) => normalizeLocation(n) === word),
    )?.[0] ||
    ""
  );
}
const cached = new Map();
export async function loadLocationCountry(code) {
  if (!Object.hasOwn(manifest.countries, code))
    throw Error("unsupported_country");
  if (!cached.has(code)) {
    const promise = fetch(`/location-data/${manifest.version}/${code}.json`, {
      credentials: "omit",
      cache: "force-cache",
    })
      .then(async (r) => {
        if (!r.ok) throw Error("data_unavailable");
        const data = await r.json();
        if (
          data.version !== manifest.version ||
          data.country !== code ||
          !Array.isArray(data.cities)
        )
          throw Error("invalid_data");
        return data;
      })
      .catch((e) => {
        cached.delete(code);
        throw e;
      });
    cached.set(code, promise);
  }
  return cached.get(code);
}
export function matchLocationTimezone(fields, data) {
  const code = locationCountry(fields.country),
    city = normalizeLocation(fields.city),
    region = normalizeLocation(fields.region);
  if (!code || !city) return { state: "incomplete", zones: [] };
  if (data.country !== code || data.version !== manifest.version)
    return { state: "unavailable", zones: [] };
  const regions = manifest.countries[code].regions;
  const regionCodes = region
    ? Object.entries(regions)
        .filter(([id, names]) =>
          [id, ...names].some((n) => normalizeLocation(n) === region),
        )
        .map(([id]) => id)
    : null;
  // Unknown or conflicting region must never be silently ignored.
  const rows = data.cities.filter(
    ([names, id]) =>
      (!regionCodes || regionCodes.includes(id)) &&
      names.some((n) => normalizeLocation(n) === city),
  );
  const zones = [
    ...new Set(rows.map((row) => row[2]).filter(validTimeZone)),
  ].sort();
  return {
    state:
      zones.length === 1
        ? "suggested"
        : zones.length
          ? "ambiguous"
          : "unmatched",
    zones,
  };
}
