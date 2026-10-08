import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  initializeCoordinationSample,
  coordinationAvailability,
} from "./landing-coordination.js";

test("the client sample follows submission, two approvals, delivery and acknowledgment without network or storage", () => {
  const dom = new JSDOM(
    readFileSync(new URL("../api/welcome.html", import.meta.url), "utf8"),
  );
  const root = dom.window.document;
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Samples must not call providers");
  };
  try {
    initializeCoordinationSample(root);
    root
      .querySelector("#sample-invitation")
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.match(
      root.querySelector("#sample-coordination-status").textContent,
      /No email was sent/,
    );
    const choose = (role) =>
      root.querySelector(`[data-coordination-role="${role}"]`).click();
    choose("client");
    root.querySelector("#sample-scope").value = "Capture only the kitchen.";
    root
      .querySelector("#sample-client-brief")
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(
      root.querySelector("#sample-agreed-scope").textContent,
      "Capture only the kitchen.",
    );
    root.querySelector("#sample-approve").click();
    assert.match(
      root.querySelector("#sample-coordination-status").textContent,
      /other party still needs/,
    );
    assert.equal(root.querySelector("#sample-approve").disabled, true);
    choose("provider");
    root.querySelector("#sample-approve").click();
    assert.match(
      root.querySelector("#sample-coordination-status").textContent,
      /approved by both sides/,
    );
    root.querySelector("#sample-approve").click();
    assert.match(
      root.querySelector("#sample-coordination-status").textContent,
      /Choose Client to acknowledge/,
    );
    choose("client");
    root.querySelector("#sample-approve").click();
    assert.match(
      root.querySelector("#sample-coordination-status").textContent,
      /delivery acknowledged/,
    );
    assert.equal(root.querySelector("#sample-approve").disabled, true);
  } finally {
    globalThis.fetch = previous;
    dom.window.close();
  }
});
test("a test or malformed availability response never advertises public coordination", () => {
  assert.match(
    coordinationAvailability({ enabled: true, public: false, status: "pilot" }),
    /restricted testing/,
  );
  for (const data of [
    undefined,
    {},
    { enabled: false, public: true, status: "available" },
    { enabled: true, public: true, status: "pilot" },
  ])
    assert.doesNotMatch(
      coordinationAvailability(data),
      /available to eligible/,
    );
  assert.match(
    coordinationAvailability({
      enabled: true,
      public: true,
      status: "available",
    }),
    /available to eligible/,
  );
});
