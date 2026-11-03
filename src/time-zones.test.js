import test from "node:test";
import assert from "node:assert/strict";
import { searchTimeZones, TIME_ZONES } from "./time-zones.js";

test("location search handles the reported places and time-zone names", () => {
  for (const query of [
    "San Diego, California",
    "san diego",
    "California",
    "America/California",
  ])
    assert.deepEqual(searchTimeZones(query).matches, ["America/Los_Angeles"]);
  assert.deepEqual(searchTimeZones("America/Texas").matches, [
    "America/Chicago",
    "America/Denver",
  ]);
  assert.deepEqual(searchTimeZones("Texas, El Paso").matches, [
    "America/Denver",
  ]);
  assert(searchTimeZones("Asia/Tokyo").matches.includes("Asia/Tokyo"));
  assert(searchTimeZones("New York").matches.includes("America/New_York"));
  assert(searchTimeZones("London").matches.includes("Europe/London"));
});

test("unrecognized or mistyped locations never leave an empty selector", () => {
  for (const query of ["por anywhere else", "zzzzunknown", "San Deigo"]) {
    const result = searchTimeZones(query);
    assert.equal(result.noMatches, true);
    assert.deepEqual(result.options, TIME_ZONES);
  }
  assert.deepEqual(searchTimeZones(" ").options, TIME_ZONES);
  assert.equal(searchTimeZones("").noMatches, false);
});
