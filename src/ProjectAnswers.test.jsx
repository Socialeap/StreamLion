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
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: ProjectAnswers } = await import("./ProjectAnswers.jsx");
const project = {
  id: "project-1",
  title: "Nassau Street",
  city: "New York",
  scope: "Capture 31 3/8 in doorway",
};

test("empty Ask keeps Google refresh reachable and can reveal newly fetched projects", async () => {
  let refreshes = 0;
  function Workspace() {
    const [jobs, setJobs] = React.useState([]);
    return (
      <ProjectAnswers
        compact
        source="google"
        projectChooser={
          <label>
            Project to discuss
            <select>
              <option>Choose a project</option>
              {jobs.map((job) => (
                <option key={job.id}>{job.title}</option>
              ))}
            </select>
          </label>
        }
        refreshProject={
          <button
            onClick={() => {
              refreshes++;
              setJobs([project]);
            }}
          >
            Refresh from Google
          </button>
        }
      />
    );
  }
  const ui = render(<Workspace />);
  try {
    assert.equal(ui.queryByRole("option", { name: project.title }), null);
    await act(async () =>
      fireEvent.click(ui.getByRole("button", { name: "Refresh from Google" })),
    );
    assert.equal(refreshes, 1);
    assert.ok(ui.getByRole("option", { name: project.title }));
    assert.ok(ui.getByRole("button", { name: "Refresh from Google" }));
  } finally {
    cleanup();
  }
});

for (const compact of [false, true]) {
  test(`Ask preserves scoped JSON export without ChatGPT controls (compact=${compact})`, async (t) => {
    t.after(cleanup);
    let exported,
      filename,
      opens = 0;
    const original = globalThis.URL.createObjectURL;
    globalThis.URL.createObjectURL = (blob) => {
      exported = blob;
      return "blob:export";
    };
    const click = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function () {
      filename = this.download;
    };
    t.after(() => {
      globalThis.URL.createObjectURL = original;
      window.HTMLAnchorElement.prototype.click = click;
    });
    window.open = () => {
      opens++;
    };
    const ui = render(
      <ProjectAnswers
        project={project}
        compact={compact}
        notes={[
          { jobId: project.id, area: "Lobby", text: "Door measured" },
          { jobId: "other", area: "Private", text: "Another customer's note" },
        ]}
      />,
    );
    assert.equal(ui.queryByRole("link", { name: /ChatGPT/i }), null);
    assert.equal(ui.queryByRole("button", { name: /Copy project/i }), null);
    assert.doesNotMatch(ui.container.textContent, /ChatGPT|paste, ask, send/);
    if (compact) fireEvent.click(ui.getByRole("button", { name: /Tools/ }));
    fireEvent.click(ui.getByText("Project snapshot and backup"));
    fireEvent.click(
      ui.getByRole("button", { name: "Download project snapshot" }),
    );
    const snapshot = JSON.parse(await exported.text());
    assert.equal(snapshot.fields.title, project.title);
    assert.equal(snapshot.fieldNotes.length, 1);
    assert.equal(snapshot.fieldNotes[0].text, "Door measured");
    assert.equal(filename, "streamlion-project-snapshot.json");
    assert.equal(opens, 0);
  });
}
