import { useEffect, useState } from "react";
import {
  loadLocationCountry,
  locationCountry,
  matchLocationTimezone,
} from "./location-timezone.js";
import { timeZoneLabel } from "./time-zones.js";
export default function LocationTimezone({
  fields,
  onUse,
  loadCountry = loadLocationCountry,
}) {
  const [result, setResult] = useState({ state: "loading", zones: [] });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    const code = locationCountry(fields.country);
    if (!code || !fields.city?.trim()) {
      setResult({ state: "incomplete", zones: [] });
      return;
    }
    setResult({ state: "loading", zones: [] });
    loadCountry(code)
      .then((data) => {
        if (current) setResult(matchLocationTimezone(fields, data));
      })
      .catch(() => {
        if (current) setResult({ state: "unavailable", zones: [] });
      });
    return () => {
      current = false;
    };
  }, [fields.city, fields.region, fields.country, retry, loadCountry]);
  return (
    <section aria-label="Time zone from project location">
      <h3>Time zone from your project location</h3>
      {result.state === "loading" && (
        <p role="status">Checking your project’s city and country…</p>
      )}
      {result.state === "incomplete" && (
        <p>
          Add the city and country in step 3, Location, to get a time-zone
          suggestion.
        </p>
      )}
      {result.state === "unmatched" && (
        <p>
          No city match for this location. Check the city, state/region and
          country in step 3, or choose the time zone below.
        </p>
      )}
      {result.state === "unavailable" && (
        <>
          <p>
            Location data is unavailable on this device. Connect once to
            download this country’s data, or choose the time zone below. Your
            entries are kept.
          </p>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry location lookup
          </button>
        </>
      )}
      {result.state === "ambiguous" && (
        <p>
          This city matches more than one time zone. Add the state/region in
          step 3 or confirm the correct zone for the visit.
        </p>
      )}
      {result.zones.map((zone) => (
        <p key={zone}>
          {fields.timeZone === zone ? (
            <span>Selected: {timeZoneLabel(zone)}</span>
          ) : (
            <button type="button" onClick={() => onUse(zone)}>
              Use {timeZoneLabel(zone)}
            </button>
          )}
        </p>
      ))}
      {!!result.zones.length && (
        <p className="hint">
          Based on the project’s city, not a street-level boundary check.
          Confirm the zone for the visit. Your current choice stays unchanged
          until you select a suggestion.
        </p>
      )}
      <small>
        Location data:{" "}
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
          GeoNames
        </a>
        ,{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        . Location matching runs on your device.
      </small>
    </section>
  );
}
