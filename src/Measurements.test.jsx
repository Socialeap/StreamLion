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
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: Measurements } = await import("./MeasurementCapture.jsx");
const project = { id: "job-a", title: "Synthetic site", deviceOnly: true };
function dictate(ui, raw) {
  fireEvent.change(ui.getByLabelText("Dictate or type measurements"), {
    target: { value: raw },
  });
  fireEvent.click(ui.getByRole("button", { name: "Organize measurements" }));
}

test("device dictation instructions, organized readings and reviewed save stay in the room", async () => {
  localStorage.clear();
  let saved;
  const ui = render(
    <Measurements
      project={project}
      notes={[]}
      scope="local"
      onSave={async (context) => {
        saved = context;
      }}
    />,
  );
  const guidance = ui.getByText(/microphone on your device/).closest("details");
  assert.equal(guidance.open, false);
  const capture = ui.getByRole("region", { name: "Measurement batch" });
  assert.ok(
    capture.compareDocumentPosition(guidance) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
  );
  fireEvent.change(ui.getByLabelText("Room or exterior area"), {
    target: { value: "Office 2" },
  });
  dictate(
    ui,
    "Length twelve feet four and three eighths inches. Width 10 feet 6 inches.",
  );
  assert.ok(ui.getByText("Length: 12′ 4 3/8″"));
  assert.equal(ui.getByLabelText("Room or exterior area").disabled, true);
  fireEvent.click(
    ui.getByLabelText("I checked these readings against the tape."),
  );
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Save reviewed measurements" }),
    ),
  );
  assert.equal(saved.jobId, "job-a");
  assert.equal(saved.reviewed, true);
  assert.equal(JSON.parse(saved.text).room, "Office 2");
  assert.equal(ui.getByLabelText("Room or exterior area").disabled, false);
  assert.ok(ui.getByRole("heading", { name: "Measurements" }));
  cleanup();
});
test("drafts resume in the same project/scope and do not leak across jobs or workbooks", () => {
  localStorage.clear();
  const props = { project, notes: [], scope: "book-a", onSave: async () => {} };
  let ui = render(<Measurements {...props} />);
  fireEvent.change(ui.getByLabelText("Room or exterior area"), {
    target: { value: "Vault" },
  });
  dictate(ui, "Length 8 ft 3 1/32 in");
  cleanup();
  ui = render(<Measurements {...props} />);
  assert.ok(ui.getByText("Length: 8′ 3 1/32″"));
  cleanup();
  ui = render(
    <Measurements {...props} project={{ ...project, id: "job-b" }} />,
  );
  assert.equal(ui.getByLabelText("Room or exterior area").value, "");
  cleanup();
  ui = render(<Measurements {...props} scope="book-b" />);
  assert.equal(ui.getByLabelText("Room or exterior area").value, "");
  cleanup();
});
test("unclear wording cannot be marked reviewed and voice corrections require an unambiguous target", async () => {
  localStorage.clear();
  let saved;
  const ui = render(
    <Measurements
      project={project}
      notes={[]}
      scope="local"
      onSave={async (context) => {
        saved = context;
      }}
    />,
  );
  fireEvent.change(ui.getByLabelText("Room or exterior area"), {
    target: { value: "Reception" },
  });
  dictate(ui, "Width 10 ft. Height 8.");
  assert.equal(
    ui.getByLabelText("I checked these readings against the tape.").disabled,
    true,
  );
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Save unreviewed measurements" }),
    ),
  );
  assert.equal(saved.reviewed, false);
  assert.equal(JSON.parse(saved.text).issues.length, 1);
  dictate(ui, "Width 10 ft.");
  dictate(ui, "Change the width to 10 feet 3/32 inches");
  assert.ok(ui.getByText("Width: 10′ 3/32″"));
  dictate(ui, "Width 5 ft.");
  dictate(ui, "Change the width to 12 ft");
  assert.match(ui.getByRole("alert").textContent, /specific entry/);
  cleanup();
});
test("saved corrections retain their expected base and changed records block stale drafts", async () => {
  localStorage.clear();
  let context;
  let ui = render(
    <Measurements
      project={project}
      notes={[]}
      scope="local"
      onSave={async (value) => {
        context = value;
      }}
    />,
  );
  fireEvent.change(ui.getByLabelText("Room or exterior area"), {
    target: { value: "Office" },
  });
  dictate(ui, "Width 10 ft");
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Save unreviewed measurements" }),
    ),
  );
  cleanup();
  const note = {
    ...context,
    id: "note-a",
    createdAt: new Date().toISOString(),
  };
  let args;
  ui = render(
    <Measurements
      project={project}
      notes={[note]}
      scope="local"
      onSave={async (...values) => {
        args = values;
      }}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Correct saved batch" }));
  dictate(ui, "Change width to 12 ft");
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Save unreviewed measurements" }),
    ),
  );
  assert.equal(args[1], "note-a");
  assert.equal(args[2], note.text);
  fireEvent.click(ui.getByRole("button", { name: "Correct saved batch" }));
  ui.rerender(
    <Measurements
      project={project}
      notes={[{ ...note, text: args[0].text }]}
      scope="local"
      onSave={async () => {}}
    />,
  );
  assert.match(ui.getByRole("alert").textContent, /saved batch changed/i);
  assert.equal(
    ui.getByRole("button", { name: "Save unreviewed measurements" }).disabled,
    true,
  );
  cleanup();
});

test("clearing or invalidating a clarification keeps review blocked across reload until valid replacement", async () => {
  localStorage.clear();
  let saved;
  const props = {
    project,
    notes: [],
    scope: "local",
    onSave: async (context) => {
      saved = context;
    },
  };
  let ui = render(<Measurements {...props} />);
  fireEvent.change(ui.getByLabelText("Room or exterior area"), {
    target: { value: "Kitchen" },
  });
  dictate(ui, "Width 10 ft. Height 8.");
  fireEvent.click(ui.getByRole("button", { name: "Correct this wording" }));
  fireEvent.change(ui.getByLabelText("Dictate or type measurements"), {
    target: { value: "" },
  });
  assert.ok(ui.getByText("Needs clarification"));
  assert.equal(
    ui.getByLabelText("I checked these readings against the tape.").disabled,
    true,
  );
  cleanup();
  ui = render(<Measurements {...props} />);
  assert.ok(ui.getByText("Needs clarification"));
  assert.equal(
    ui.getByLabelText("I checked these readings against the tape.").disabled,
    true,
  );
  dictate(ui, "Height eight");
  assert.ok(ui.getByText("Needs clarification"));
  assert.ok(ui.getByRole("alert"));
  assert.equal(
    ui.getByLabelText("I checked these readings against the tape.").disabled,
    true,
  );
  dictate(ui, "Height eight feet");
  assert.equal(ui.queryByText("Needs clarification"), null);
  assert.ok(ui.getByText("Width: 10′ 0″"));
  assert.ok(ui.getByText("Height: 8′ 0″"));
  fireEvent.click(
    ui.getByLabelText("I checked these readings against the tape."),
  );
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Save reviewed measurements" }),
    ),
  );
  assert.equal(saved.reviewed, true);
  assert.equal(JSON.parse(saved.text).issues.length, 0);
  assert.ok(JSON.parse(saved.text).raw.includes("Height 8"));
  cleanup();
});
