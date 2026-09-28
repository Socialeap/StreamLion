import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSaveDestination,
  noteControlsFor,
  visibleProjects,
} from "./project-routing.js";

test("a device-only project remains available after connecting an empty workbook", () => {
  const nassau = {
    id: "nassau-id",
    title: "Nassau Street",
    reviewState: "draft",
  };
  const projects = visibleProjects({ Projects: [] }, [nassau]);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].title, "Nassau Street");
  assert.equal(projects[0].deviceOnly, true);

  const afterSave = visibleProjects(
    { Projects: [{ recordId: "nassau-id", title: "Nassau Street" }] },
    [nassau],
  );
  assert.equal(afterSave.length, 1);
  assert.equal(afterSave[0].deviceOnly, undefined);
});

test("note controls follow the selected project's owner in a mixed workspace", () => {
  const remote = { Projects: [] };
  assert.deepEqual(
    noteControlsFor({ deviceOnly: true }, "workbook-id", remote),
    {
      draftScope: "local",
      allowAudio: true,
    },
  );
  assert.deepEqual(noteControlsFor({}, "workbook-id", remote), {
    draftScope: "workbook-id",
    allowAudio: false,
  });
});

test("remembered Google workbook cannot silently fall back to a device save", () => {
  assert.throws(
    () => assertSaveDestination("workbook-id", null),
    /Reconnect Google.*draft is still on this device/,
  );
  assert.doesNotThrow(() => assertSaveDestination("", null));
  assert.doesNotThrow(() =>
    assertSaveDestination("workbook-id", { Projects: [] }),
  );
});
