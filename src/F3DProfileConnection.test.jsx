import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "https://streamlion.transcendencemedia.com",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { render, cleanup, fireEvent, waitFor } =
  await import("@testing-library/react");
const { default: Disclosure, ProfileConnection } =
  await import("./F3DProfileConnection.jsx");
test.afterEach(cleanup);
test.after(() => dom.window.close());
const result = {
  subject: "a",
  account: "a@example.com",
  available: true,
  connected: true,
  verifiedAt: Date.now(),
  snapshot: {
    businessProfile: {
      name: "Harbor",
      phone: "555",
      city: "Portland",
      region: "OR",
    },
    directoryProfile: {
      name: "Other name",
      city: "Portland",
      region: "OR",
      services: ["matterport"],
    },
  },
};
test("optional connection makes no backend calls until opened", async () => {
  let calls = 0;
  const ui = render(
    <Disclosure
      connected
      account="a@example.com"
      api={async () => {
        calls++;
        return result;
      }}
    />,
  );
  assert.equal(calls, 0);
  fireEvent.click(ui.getByText("Connect or refresh your F|3D profile"));
  await ui.findByText(/Profile snapshot connected/);
  assert.equal(calls, 1);
  assert(ui.getByText(/names differ/));
  assert(ui.getByText(/saved snapshot/));
});
test("unavailable bridge retains F3D navigation without enabling account actions", async () => {
  const ui = render(
    <ProfileConnection
      connected
      account="a@example.com"
      api={async () => ({ ...result, available: false, connected: false })}
    />,
  );
  await ui.findByText(/not enabled yet/);
  assert.equal(
    ui.queryByRole("button", { name: "Connect F|3D account" }),
    null,
  );
  assert(ui.getByRole("link", { name: /Manage your F/ }));
});
test("late account responses cannot display or link another account profile", async () => {
  let resolve;
  const api = () => new Promise((done) => (resolve = done));
  const ui = render(
    <ProfileConnection connected account="a@example.com" api={api} />,
  );
  ui.rerender(<ProfileConnection connected={false} account="" api={api} />);
  resolve(result);
  await waitFor(() =>
    assert.equal(ui.queryByText(/Profile snapshot connected/), null),
  );
  assert(ui.getByText(/Sign in to Google/));
});
test("unlink only removes local snapshot through the account-scoped endpoint", async () => {
  const calls = [];
  const api = async (body, subject) => {
    if (body) calls.push([body, subject]);
    return body ? { ...result, connected: false, snapshot: null } : result;
  };
  const ui = render(
    <ProfileConnection connected account="a@example.com" api={api} />,
  );
  fireEvent.click(
    await ui.findByRole("button", { name: "Unlink profile snapshot" }),
  );
  await ui.findByRole("button", { name: "Connect F|3D account" });
  assert.deepEqual(calls, [[{ action: "unlink" }, "a"]]);
});

test("successful popup approval is saved before reporting a connection", async () => {
  const calls = [],
    popup = {
      location: { href: "" },
      postMessage() {},
      close() {
        this.closed = true;
      },
      closed: false,
    };
  const old = window.open;
  window.open = () => popup;
  try {
    const api = async (body) => {
      if (body) calls.push(body);
      if (body?.action === "start")
        return {
          nonce: "N".repeat(43),
          connectUrl:
            "https://www.frontiers3d.com/dashboard/profile?connect=streamlion",
        };
      return body ? result : { ...result, connected: false, snapshot: null };
    };
    const ui = render(
      <ProfileConnection connected account="a@example.com" api={api} />,
    );
    fireEvent.click(
      await ui.findByRole("button", { name: "Connect F|3D account" }),
    );
    await waitFor(() =>
      assert(popup.location.href.includes("connect=streamlion")),
    );
    assert.equal(ui.queryByText(/Profile snapshot connected/), null);
    fireEvent(
      window,
      new window.MessageEvent("message", {
        origin: "https://www.frontiers3d.com",
        source: popup,
        data: {
          type: "f3d-profile-approved",
          nonce: "N".repeat(43),
          assertion: "signed",
        },
      }),
    );
    await ui.findByText(/Profile snapshot connected/);
    assert.deepEqual(
      calls.map((c) => c.action),
      ["start", "complete"],
    );
    assert.equal(popup.closed, true);
  } finally {
    window.open = old;
  }
});

test("lost completion response reconciles saved state without retrying the approval write", async () => {
  const popup = {
      location: { href: "" },
      postMessage() {},
      close() {},
      closed: false,
    },
    old = window.open;
  window.open = () => popup;
  let saved = false,
    completions = 0;
  try {
    const api = async (body) => {
      if (body?.action === "start")
        return {
          nonce: "N".repeat(43),
          connectUrl:
            "https://www.frontiers3d.com/dashboard/profile?connect=streamlion",
        };
      if (body?.action === "complete") {
        saved = true;
        completions++;
        throw new Error("Connection interrupted.");
      }
      return saved ? result : { ...result, connected: false, snapshot: null };
    };
    const ui = render(
      <ProfileConnection connected account="a@example.com" api={api} />,
    );
    fireEvent.click(
      await ui.findByRole("button", { name: "Connect F|3D account" }),
    );
    await waitFor(() => assert(popup.location.href));
    fireEvent(
      window,
      new window.MessageEvent("message", {
        origin: "https://www.frontiers3d.com",
        source: popup,
        data: {
          type: "f3d-profile-approved",
          nonce: "N".repeat(43),
          assertion: "signed",
        },
      }),
    );
    await ui.findByText(/Profile snapshot connected/);
    assert.equal(completions, 1);
  } finally {
    window.open = old;
  }
});

test("wizard launches only its current account's linked draft in a separate tab", async () => {
  const owner = "a0000000-0000-4000-8000-000000000001";
  const profile = "b0000000-0000-4000-8000-000000000001";
  const api = async () => ({
    ...result,
    snapshot: { ...result.snapshot, accountId: owner,
      businessProfile: { ...result.snapshot.businessProfile, id: profile } },
  });
  const ui = render(<ProfileConnection connected account="a@example.com" showDraftEditor api={api} />);
  const link = await ui.findByRole("link", { name: /Edit your F/ });
  assert.equal(link.href, `https://www.frontiers3d.com/dashboard/profile?connect=streamlion-draft#owner=${owner}&profile=${profile}`);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  ui.rerender(<ProfileConnection connected account="b@example.com" showDraftEditor api={api} />);
  assert.equal(ui.queryByRole("link", { name: /Edit your F/ }), null);
  await ui.findByRole("alert");
  assert.equal(ui.queryByText(/Harbor/), null);
});

test("a connected snapshot without a business profile cannot open the draft editor", async () => {
  const api = async () => ({
    ...result, snapshot: { ...result.snapshot,
      accountId: "a0000000-0000-4000-8000-000000000001", businessProfile: null },
  });
  const ui = render(<ProfileConnection connected account="a@example.com" showDraftEditor api={api} />);
  await ui.findByText(/Profile snapshot connected/);
  assert.equal(ui.queryByRole("link", { name: /Edit your F/ }), null);
});
