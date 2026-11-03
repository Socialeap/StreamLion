import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<html><body></body></html>");
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { render, fireEvent, cleanup } = await import("@testing-library/react");
const { default: LocationTimezone } = await import("./LocationTimezone.jsx");
const { LOCATION_DATA_VERSION } = await import("./location-timezone.js");
const fields = {
  city: "Miami",
  region: "FL",
  country: "US",
  timeZone: "Asia/Tokyo",
};
const dataset = {
  version: LOCATION_DATA_VERSION,
  country: "US",
  cities: [[["Miami"], "FL", "America/New_York"]],
};
test.afterEach(cleanup);
test.after(() => dom.window.close());
test("suggestion is explicit and preserves a manual choice until confirmation", async () => {
  let chosen = "";
  const ui = render(
    <LocationTimezone
      fields={fields}
      loadCountry={async () => dataset}
      onUse={(v) => (chosen = v)}
    />,
  );
  const button = await ui.findByRole("button", {
    name: "Use America / New York",
  });
  assert.equal(chosen, "");
  fireEvent.click(button);
  assert.equal(chosen, "America/New_York");
  assert.equal(fields.timeZone, "Asia/Tokyo");
});
test("late lookup cannot replace a newer location; failure leaves manual recovery", async () => {
  let resolve;
  const loader = () => new Promise((r) => (resolve = r));
  const ui = render(
    <LocationTimezone
      fields={fields}
      loadCountry={loader}
      onUse={() => {
        throw Error("automatic mutation");
      }}
    />,
  );
  ui.rerender(
    <LocationTimezone
      fields={{ ...fields, city: "" }}
      loadCountry={loader}
      onUse={() => {}}
    />,
  );
  resolve(dataset);
  await ui.findByText(/Add the city and country/);
  assert.equal(
    ui.queryByRole("button", { name: "Use America / New York" }),
    null,
  );
});
test("offline first-use failure is clear and retryable without changing fields", async () => {
  const ui = render(
    <LocationTimezone
      fields={fields}
      loadCountry={async () => {
        throw Error("offline");
      }}
      onUse={() => {
        throw Error("mutation");
      }}
    />,
  );
  await ui.findByText(/Location data is unavailable/);
  assert(ui.getByRole("button", { name: "Retry location lookup" }));
});
