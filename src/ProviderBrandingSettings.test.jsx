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
const { render, fireEvent, cleanup, waitFor } =
  await import("@testing-library/react");
const {
  default: Settings,
  prepareLogo,
  brandingAPI,
} = await import("./ProviderBrandingSettings.jsx");
const profile = {
  name: "Harbor Capture",
  website: "https://example.com",
  logo: "",
  shape: "rounded",
};
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=";
test("Account saves business name, normalized logo shape and website explicitly; failed save retains edits", async (t) => {
  t.after(cleanup);
  const writes = [];
  let fail = false;
  const api = async (body, subject) => {
    if (body) {
      writes.push({ body, subject });
      if (fail) throw new Error("Network unavailable");
      return {
        subject: "a",
        available: true,
        version: 1,
        branding: body.branding,
      };
    }
    return { subject: "a", available: true, version: 0, branding: profile };
  };
  const ui = render(
    <Settings
      connected
      account="a@example.com"
      api={api}
      convertLogo={async () => PNG}
    />,
  );
  await ui.findByDisplayValue("Harbor Capture");
  fireEvent.change(ui.getByLabelText("Business name clients will see"), {
    target: { value: "Provider A" },
  });
  fireEvent.change(ui.getByLabelText("Logo display shape"), {
    target: { value: "rectangle" },
  });
  fireEvent.change(ui.getByLabelText("Upload your logo (optional)"), {
    target: {
      files: [new dom.window.File(["logo"], "logo.png", { type: "image/png" })],
    },
  });
  await ui.findByRole("img", { name: "Provider A logo" });
  assert.equal(writes.length, 0);
  fireEvent.click(ui.getByRole("button", { name: "Save business branding" }));
  await ui.findByText(/Business branding saved/);
  assert.equal(writes[0].subject, "a");
  assert.equal(writes[0].body.branding.logo, PNG);
  assert.equal(writes[0].body.branding.shape, "rectangle");
  assert.equal(
    ui.getByRole("link", { name: /example.com/ }).getAttribute("rel"),
    "noopener noreferrer",
  );
  fail = true;
  fireEvent.change(ui.getByLabelText("Business name clients will see"), {
    target: { value: "Unsaved business" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save business branding" }));
  await ui.findByRole("alert");
  assert.equal(
    ui.getByLabelText("Business name clients will see").value,
    "Unsaved business",
  );
  assert.equal(
    ui.getByRole("button", { name: "Save business branding" }).disabled,
    false,
  );
});
test("account switch ignores a stale branding load and never copies another account profile", async (t) => {
  t.after(cleanup);
  let complete;
  const api = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const ui = render(<Settings connected account="a@example.com" api={api} />);
  ui.rerender(<Settings connected={false} account="" api={api} />);
  complete({ subject: "a", available: true, branding: profile });
  await waitFor(() =>
    assert.equal(ui.queryByDisplayValue("Harbor Capture"), null),
  );
  assert.ok(ui.getByText(/Sign in to Google to save/));
});
test("upload rejects SVG and oversized input before image decoding", async () => {
  await assert.rejects(
    () => prepareLogo({ type: "image/svg+xml", size: 10 }),
    /PNG, JPEG or WebP/,
  );
  await assert.rejects(
    () => prepareLogo({ type: "image/png", size: 6 * 1024 * 1024 }),
    /under 5 MB/,
  );
});
test("branding POST uses bounded fetch and is never retried on a server failure", async (t) => {
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
  await assert.rejects(
    () => brandingAPI({ branding: profile, version: 0 }, "a"),
    /Unavailable/,
  );
  assert.equal(calls, 1);
});
test("unsaved branding starts from setup answers, while saved branding is never replaced", async (t) => {
  t.after(cleanup);
  const suggestion = {
    name: "Setup Studio",
    website: "https://setup.example/",
    logo: "",
    shape: "rounded",
  };
  const fresh = async () => ({
    subject: "a",
    available: true,
    version: 0,
    branding: { name: "", website: "", logo: "", shape: "rounded" },
  });
  const ui = render(
    <Settings
      connected
      account="a@example.com"
      api={fresh}
      suggestion={suggestion}
    />,
  );
  await ui.findByDisplayValue("Setup Studio");
  assert.equal(
    ui.getByLabelText("Business website (optional)").value,
    "https://setup.example/",
  );
  assert(ui.getByText(/Filled in from your setup assistant answers/));
  cleanup();
  const saved = async () => ({
    subject: "a",
    available: true,
    version: 2,
    branding: profile,
  });
  const kept = render(
    <Settings
      connected
      account="a@example.com"
      api={saved}
      suggestion={suggestion}
    />,
  );
  await kept.findByDisplayValue("Harbor Capture");
  assert.equal(kept.queryByText(/setup assistant/), null);
});
