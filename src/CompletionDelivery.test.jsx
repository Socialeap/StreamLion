import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example",
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
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: CompletionDelivery } =
  await import("./CompletionDelivery.jsx");
const job = { id: "job-a", revision: 3, chargeAuthorizedMicros: 3000000 };
const brief = {
  document:
    "<!doctype html><html><body>Reviewed Completion Brief</body></html>",
  hash: "a".repeat(64),
};
test("delivery requires an explicit review and submits the preview hash and exact quote", async (t) => {
  t.after(cleanup);
  const sent = [];
  const ui = render(
    <CompletionDelivery
      job={job}
      busy={false}
      command={(...args) => sent.push(args)}
      prepareCompletion={async () => brief}
    />,
  );
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Prepare Completion Brief" }),
    ),
  );
  const frame = ui.getByTitle("Completion Brief preview");
  assert.equal(frame.getAttribute("sandbox"), "");
  assert.equal(frame.getAttribute("srcdoc"), brief.document);
  const send = ui.getByRole("button", {
    name: "Deliver Completion Brief · 240 credits",
  });
  assert.equal(send.disabled, true);
  fireEvent.click(ui.getByRole("checkbox"));
  fireEvent.click(send);
  assert.deepEqual(sent, [
    [
      job,
      "progress",
      {
        state: "delivered",
        completionHash: brief.hash,
        completionReviewed: true,
        authorizedMicros: 3000000,
      },
    ],
  ]);
});
test("a late preview cannot authorize delivery after the job revision changes", async (t) => {
  t.after(cleanup);
  let resolve;
  const prepareCompletion = () =>
    new Promise((done) => {
      resolve = done;
    });
  const ui = render(
    <CompletionDelivery
      job={job}
      busy={false}
      command={() => {
        throw new Error("must not deliver");
      }}
      prepareCompletion={prepareCompletion}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Prepare Completion Brief" }));
  ui.rerender(
    <CompletionDelivery
      job={{ ...job, revision: 4 }}
      busy={false}
      command={() => {
        throw new Error("must not deliver");
      }}
      prepareCompletion={prepareCompletion}
    />,
  );
  await act(async () => resolve(brief));
  assert.equal(ui.queryByTitle("Completion Brief preview"), null);
  assert.equal(ui.queryByRole("checkbox"), null);
});

test("correction delivery shows no new fee while retaining review and the server settlement contract", async (t) => {
  t.after(cleanup);
  const corrected = {
    ...job,
    revision: 20,
    completion: { attachmentId: "original-delivery", hash: "b".repeat(64) },
  };
  const sent = [];
  const ui = render(
    <CompletionDelivery
      job={corrected}
      busy={false}
      command={(...args) => sent.push(args)}
      prepareCompletion={async () => brief}
    />,
  );
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Prepare Completion Brief" }),
    ),
  );
  const send = ui.getByRole("button", {
    name: "Deliver corrected Completion Brief · no additional credits",
  });
  assert.equal(send.disabled, true);
  assert.match(
    ui.getByRole("checkbox").parentElement.textContent,
    /adds no project fee/,
  );
  fireEvent.click(ui.getByRole("checkbox"));
  fireEvent.click(send);
  assert.equal(sent[0][2].authorizedMicros, 3000000);
  assert.equal(sent[0][2].completionHash, brief.hash);
  assert.equal(sent[0][2].completionReviewed, true);
});
