import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  locationCountry,
  matchLocationTimezone,
  LOCATION_DATA_VERSION,
} from "./location-timezone.js";
const data = (code) =>
  JSON.parse(
    readFileSync(`public/location-data/${LOCATION_DATA_VERSION}/${code}.json`),
  );
test("real bundled records resolve reported US cities and international locations", () => {
  for (const [city, region, country, expected] of [
    ["Miami", "Florida", "USA", "America/New_York"],
    ["San Diego", "CA", "United States", "America/Los_Angeles"],
    ["Richmond", "Virginia", "US", "America/New_York"],
    ["El Paso", "TX", "US", "America/Denver"],
    ["London", "England", "UK", "Europe/London"],
    ["Toronto", "Ontario", "Canada", "America/Toronto"],
  ]) {
    const result = matchLocationTimezone(
      { city, region, country },
      data(locationCountry(country)),
    );
    assert.deepEqual(result, { state: "suggested", zones: [expected] }, city);
  }
});
test("incomplete, conflicting and ambiguous cities never become guessed zones", () => {
  assert.equal(
    matchLocationTimezone({ city: "Miami" }, data("US")).state,
    "incomplete",
  );
  assert.equal(
    matchLocationTimezone(
      { city: "Miami", region: "California", country: "US" },
      data("US"),
    ).state,
    "unmatched",
  );
  assert.equal(
    matchLocationTimezone({ city: "Portland", country: "US" }, data("US"))
      .state,
    "ambiguous",
  );
  assert.equal(
    matchLocationTimezone(
      { city: "not a real town", country: "US" },
      data("US"),
    ).state,
    "unmatched",
  );
});

test("static data requests contain only country and version; loads are shared and failures retry", async (t) => {
  const { loadLocationCountry } = await import("./location-timezone.js");
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `/location-data/${LOCATION_DATA_VERSION}/FR.json`);
    assert.equal(options.credentials, "omit");
    if (++attempts === 1) throw Error("offline");
    return Response.json({
      version: LOCATION_DATA_VERSION,
      country: "FR",
      cities: [],
    });
  });
  await assert.rejects(loadLocationCountry("FR"));
  const [a, b] = await Promise.all([
    loadLocationCountry("FR"),
    loadLocationCountry("FR"),
  ]);
  assert.equal(a, b);
  assert.equal(attempts, 2);
});
