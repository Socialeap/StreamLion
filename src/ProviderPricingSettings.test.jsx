import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example/?page=Account",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { render, fireEvent, cleanup, waitFor, within } =
  await import("@testing-library/react");
const { default: Settings, pricingAPI } =
  await import("./ProviderPricingSettings.jsx");
const { default: Intake } = await import("./ProspectIntake.jsx");
const { blankPricing, validatePricing } = await import("./provider-pricing.js");
test("nine named profiles disable additions while leaving the unpublished default editable", async (t) => {
  t.after(cleanup);
  const profiles = Array.from({ length: 9 }, (_, i) => ({
    id: `named-${i}`,
    name: `Service ${i}`,
    version: 1,
    config: blankPricing(),
  }));
  const writes = [];
  const api = async (body) => {
    if (body) {
      writes.push(body);
      profiles.push({ ...body, version: 1 });
    }
    return { subject: "a", available: true, profiles: [...profiles] };
  };
  const ui = render(<Settings connected account="a@example.com" api={api} />);
  const publish = await ui.findByRole("button", {
    name: "Publish pricing for new forms",
  });
  assert.equal(
    ui.getByRole("button", { name: "Add service pricing profile" }).disabled,
    true,
  );
  assert.equal(publish.disabled, false);
  fireEvent.click(publish);
  await ui.findByText(/Pricing published/);
  assert.equal(writes[0].id, "default");
  assert.equal(profiles.length, 10);
  assert.equal(
    ui.getByRole("button", { name: "Add service pricing profile" }).disabled,
    true,
  );
});
test("Account previews tier choices, named extras and budgets before an explicit publish", async (t) => {
  t.after(cleanup);
  const writes = [];
  const api = async (body) => {
    if (!body) return { subject: "a", available: true, profiles: [] };
    writes.push(body);
    return {
      subject: "a",
      available: true,
      profiles: [{ ...body, version: 1 }],
    };
  };
  const ui = render(<Settings connected account="a@example.com" api={api} />);
  await ui.findByRole("button", { name: "Publish pricing for new forms" });
  fireEvent.change(ui.getByLabelText("Pricing method"), {
    target: { value: "progressive" },
  });
  fireEvent.change(ui.getByLabelText("Preview square footage"), {
    target: { value: "6000" },
  });
  const preview = within(ui.getByRole("region", { name: "Pricing preview" }));
  await preview.findByText("$870.00");
  fireEvent.click(ui.getByRole("button", { name: "Add named extra" }));
  fireEvent.change(ui.getByLabelText("Extra name · 1"), {
    target: { value: "Editing" },
  });
  fireEvent.change(ui.getByLabelText("Price per unit · 1"), {
    target: { value: "50" },
  });
  fireEvent.change(ui.getByLabelText("Editing quantity (hour)"), {
    target: { value: "3" },
  });
  await preview.findByText("$1,020.00");
  fireEvent.click(ui.getByLabelText("Let clients propose a budget"));
  assert.equal(writes.length, 0);
  fireEvent.click(
    ui.getByRole("button", { name: "Publish pricing for new forms" }),
  );
  await ui.findByText(/Pricing published/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].config.allowBudget, true);
  assert.equal(writes[0].config.extras[0].unit, "hour");
  fireEvent.change(ui.getByLabelText("Pricing method"), {
    target: { value: "flat" },
  });
  fireEvent.change(ui.getByLabelText("Project fee · tier 1"), {
    target: { value: "500" },
  });
  fireEvent.change(ui.getByLabelText("Project fee · tier 2"), {
    target: { value: "900" },
  });
  fireEvent.change(ui.getByLabelText("Editing quantity (hour)"), {
    target: { value: "3" },
  });
  await preview.findByText("$1,050.00");
});
test("invalid pricing retains the editor draft and a switched account ignores a late load", async (t) => {
  t.after(cleanup);
  let writes = 0;
  const api = async (body) => {
    if (body) writes++;
    return { subject: "a", available: true, profiles: [] };
  };
  const ui = render(<Settings connected account="a@example.com" api={api} />);
  await ui.findByRole("button", { name: "Publish pricing for new forms" });
  fireEvent.change(ui.getByLabelText("Pricing method"), {
    target: { value: "area" },
  });
  fireEvent.change(ui.getByLabelText("Rate per square foot"), {
    target: { value: "-1" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Publish pricing for new forms" }),
  );
  await ui.findByRole("alert");
  assert.equal(writes, 0);
  assert.equal(ui.getByLabelText("Rate per square foot").value, "-1");
  ui.unmount();
  let finish;
  const slow = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const next = render(
    <Settings connected account="a@example.com" api={slow} />,
  );
  next.rerender(<Settings connected={false} account="" api={slow} />);
  finish({ subject: "a", available: true, profiles: [] });
  await waitFor(() =>
    assert.ok(next.getByText("Sign in to Google to configure pricing.")),
  );
});
test("stale client pricing refresh preserves all answers and permits a new submission after review", async (t) => {
  t.after(cleanup);
  const config = validatePricing({
      ...blankPricing(),
      method: "area",
      rate: "0.15",
      allowBudget: true,
    }),
    initial = {
      brand: "Provider A",
      reusable: true,
      pricing: { key: "default:1", version: 1, name: "Capture", config },
      visit: "visit",
    };
  const writes = [];
  let attempts = 0;
  const api = async (path, body) => {
    if (path === "public/open")
      return {
        ...initial,
        pricing: {
          ...initial.pricing,
          key: "default:2",
          version: 2,
          config: { ...config, rate: "0.20" },
        },
      };
    if (path === "public/submit") {
      writes.push(body);
      if (++attempts === 1)
        throw Object.assign(new Error("Pricing changed"), {
          status: 409,
          code: "pricing_changed",
        });
      return { message: "Request submitted" };
    }
    throw new Error(path);
  };
  const ui = render(<Intake descriptor={initial} token="token" api={api} />);
  fireEvent.change(ui.getByLabelText("Approximate square footage"), {
    target: { value: "5000" },
  });
  fireEvent.change(ui.getByLabelText(/Your proposed budget/), {
    target: { value: "600" },
  });
  for (const [label, value] of [
    [/Street address/, "Original site"],
    [/Scope of work/, "Exact scope 12 7/16 in."],
    [/Requested by/, "Client A"],
  ])
    fireEvent.change(ui.getByLabelText(label), { target: { value } });
  fireEvent.submit(
    ui
      .getByRole("button", { name: "Submit work-order request" })
      .closest("form"),
  );
  await ui.findByRole("button", { name: "Review updated pricing" });
  fireEvent.click(ui.getByRole("button", { name: "Review updated pricing" }));
  await ui.findByText(/Pricing refreshed/);
  assert.equal(
    ui.getByLabelText(/Scope of work/).value,
    "Exact scope 12 7/16 in.",
  );
  assert.equal(ui.getByLabelText(/Your proposed budget/).value, "600");
  assert.equal(
    ui.getByRole("button", { name: "Submit work-order request" }).disabled,
    false,
  );
  fireEvent.submit(
    ui
      .getByRole("button", { name: "Submit work-order request" })
      .closest("form"),
  );
  await ui.findByText("Request submitted");
  assert.equal(writes[0].pricingKey, "default:1");
  assert.equal(writes[1].pricingKey, "default:2");
  assert.notEqual(writes[0].operation, writes[1].operation);
  assert.equal(writes[1].fields.scope, "Exact scope 12 7/16 in.");
});
test("pricing writes are bounded and are never automatically retried", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.ok(options.signal);
    assert.equal(options.method, "POST");
    return new Response(JSON.stringify({ error: "Unavailable" }), {
      status: 503,
    });
  };
  await assert.rejects(pricingAPI({ id: "default" }, "a"), /Unavailable/);
  assert.equal(calls, 1);
});
test("an unpublished default starts from setup pricing without publishing it", async (t) => {
  t.after(cleanup);
  const writes = [];
  const api = async (body) => {
    if (body) writes.push(body);
    return { subject: "a", available: true, profiles: [] };
  };
  const suggestion = validatePricing({
    ...blankPricing(),
    method: "area",
    currency: "CAD",
    rate: "0.22",
  });
  const ui = render(
    <Settings
      connected
      account="a@example.com"
      api={api}
      suggestion={suggestion}
    />,
  );
  await ui.findByText(/Filled in from your setup assistant answers/);
  assert.equal(ui.getByLabelText("Rate per square foot").value, "0.22");
  assert.equal(ui.getByLabelText("Currency (ISO code)").value, "CAD");
  assert.equal(writes.length, 0);
});
