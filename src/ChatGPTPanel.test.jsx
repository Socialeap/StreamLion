import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
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
const { default: ChatGPTPanel } = await import("./ChatGPTPanel.jsx");
const project = {
  id: "project-1",
  title: "Nassau Street",
  city: "New York",
  scope: "Capture 31 3/8 in doorway",
};
function clipboard(writeText) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

test("Ask copies the selected data separately from opening ChatGPT and explains how to paste", async () => {
  let copied = "",
    opened = [];
  clipboard(async (text) => {
    copied = text;
  });
  window.open = (...args) => {
    opened.push(args);
    return { focus() {} };
  };
  const ui = render(<ChatGPTPanel project={project} />);
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "1. Copy project details" }),
    ),
  );
  assert.ok(copied.includes("Nassau Street"));
  assert.ok(copied.includes("31 3/8 in doorway"));
  assert.equal(opened.length, 0);
  assert.match(ui.getByRole("status").textContent, /Project details copied/);
  assert.match(
    ui.getByText(/Computer: press/).textContent,
    /Ctrl\+V.*Phone or tablet: touch and hold/,
  );
  copied = "unchanged";
  fireEvent.click(ui.getByRole("link", { name: "2. Open ChatGPT" }));
  assert.equal(copied, "unchanged");
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0][0]).hostname, "chatgpt.com");
  assert.ok(!opened[0][0].includes("Nassau"));
  ui.rerender(
    <ChatGPTPanel
      project={{ ...project, id: "project-2", title: "Another site" }}
    />,
  );
  assert.equal(ui.queryByRole("status"), null);
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "1. Copy project details" }),
    ),
  );
  assert.ok(copied.includes("Another site"));
  assert.ok(!copied.includes("Nassau"));
  cleanup();
});

test("clipboard failure allows retry and offers a file fallback without opening ChatGPT", async () => {
  let attempts = 0,
    opened = 0;
  clipboard(async () => {
    if (++attempts === 1) throw new Error("Blocked");
  });
  window.open = () => {
    opened++;
    return null;
  };
  const ui = render(<ChatGPTPanel project={project} />);
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "1. Copy project details" }),
    ),
  );
  assert.match(ui.getByRole("status").textContent, /Could not copy.*download/);
  assert.equal(opened, 0);
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "1. Copy project details" }),
    ),
  );
  assert.match(ui.getByRole("status").textContent, /Project details copied/);
  assert.equal(attempts, 2);
  cleanup();
});

test("timestamp-only renders preserve pending copying and confirmation; edited records reset it", async () => {
  let resolveCopy;
  clipboard(
    () =>
      new Promise((resolve) => {
        resolveCopy = resolve;
      }),
  );
  const ui = render(
    <ChatGPTPanel project={project} asOf="2026-09-30T10:00:00Z" />,
  );
  fireEvent.click(ui.getByRole("button", { name: "1. Copy project details" }));
  ui.rerender(
    <ChatGPTPanel project={{ ...project }} asOf="2026-09-30T10:00:01Z" />,
  );
  assert.equal(
    ui.getByRole("button", { name: "Copying project details…" }).disabled,
    true,
  );
  await act(async () => resolveCopy());
  assert.match(ui.getByRole("status").textContent, /Project details copied/);
  ui.rerender(
    <ChatGPTPanel project={{ ...project }} asOf="2026-09-30T10:00:02Z" />,
  );
  assert.match(ui.getByRole("status").textContent, /Project details copied/);
  ui.rerender(
    <ChatGPTPanel
      project={{ ...project, scope: "Updated capture work" }}
      asOf="2026-09-30T10:00:02Z"
    />,
  );
  assert.equal(ui.queryByRole("status"), null);
  clipboard(async () => {});
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "1. Copy project details" }),
    ),
  );
  ui.rerender(
    <ChatGPTPanel
      project={{ ...project, scope: "Updated capture work" }}
      notes={[{ jobId: project.id, area: "Entrance", text: "New observation" }]}
    />,
  );
  assert.equal(ui.queryByRole("status"), null);
  cleanup();
});
