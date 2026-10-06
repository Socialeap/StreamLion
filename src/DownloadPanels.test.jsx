import "fake-indexeddb/auto";
import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { render, fireEvent, cleanup } = await import("@testing-library/react");
const { default: BackupPanel } = await import("./BackupPanel.jsx");
const { default: SupportPanel } = await import("./SupportPanel.jsx");
const { openLocalDatabase } = await import("./storage.js");
let downloaded = [];
let blobs = [];
URL.createObjectURL = (blob) => {
  blobs.push(blob);
  return "blob:synthetic-download";
};
URL.revokeObjectURL = () => {};
dom.window.HTMLAnchorElement.prototype.click = function () {
  downloaded.push(this.download);
};
async function reset() {
  cleanup();
  localStorage.clear();
  downloaded = [];
  blobs = [];
  const db = await openLocalDatabase();
  await db.clear("workspace");
  await db.clear("audio");
}
test("both downloads show preparation, then an adjacent filename and honest started feedback", async () => {
  for (const [Panel, label, preparing, filename] of [
    [
      BackupPanel,
      "Download device backup",
      "Preparing backup…",
      `streamlion-backup-${new Date().toISOString().slice(0, 10)}.json`,
    ],
    [
      SupportPanel,
      "Download support details",
      "Preparing support details…",
      "streamlion-diagnostics.json",
    ],
  ]) {
    await reset();
    const ui = render(<Panel />);
    fireEvent.click(ui.getByRole("button", { name: label }));
    assert.equal(ui.getByRole("button", { name: preparing }).disabled, true);
    assert.match(ui.getByRole("status").textContent, /Keep StreamLion open/);
    await ui.findByText(filename);
    const feedback = ui.getByRole("status");
    assert.match(feedback.textContent, /download started/);
    assert.match(feedback.textContent, /Check Downloads or your file manager/);
    assert.doesNotMatch(
      feedback.textContent,
      /saved successfully|download complete/i,
    );
    assert.deepEqual(downloaded, [filename]);
    assert.equal(ui.getByRole("button", { name: label }).disabled, false);
    if (Panel === SupportPanel) {
      const details = JSON.parse(await blobs[0].text());
      assert.equal(details.service, "StreamLion");
      assert.equal(details.displayMode, "browser");
      assert.equal(details.theme, "light");
      assert.equal(details.deviceFieldRecords, 0);
      assert.equal("bookId" in details, false);
    }
  }
  cleanup();
});
test("a failed backup keeps its draft and shows an error without success feedback", async () => {
  await reset();
  const key = "streamlion-draft-v1:local:unknown:";
  localStorage.setItem(key, '{"text":"original 6 7/16 inches"}');
  const ui = render(<BackupPanel />);
  fireEvent.click(ui.getByRole("button", { name: "Download device backup" }));
  assert.match(
    (await ui.findByRole("alert")).textContent,
    /Unrecognized backup draft/,
  );
  assert.equal(ui.queryByText(/download started/), null);
  assert.deepEqual(downloaded, []);
  assert.equal(localStorage.getItem(key), '{"text":"original 6 7/16 inches"}');
  cleanup();
});
test.after(() => dom.window.close());
