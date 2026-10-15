import test from "node:test";
import assert from "node:assert/strict";
import { folderLocation } from "./folder-location.js";
const mimeType = "application/vnd.google-apps.folder";
function drive(files, calls = []) {
  return async (path, options) => {
    assert.equal(options, undefined);
    assert.match(path, /supportsAllDrives=true/);
    const id = path.split("/").pop().split("?")[0];
    calls.push(id);
    return files[id]
      ? Response.json({ mimeType, ...files[id] })
      : Response.json({}, { status: 404 });
  };
}
test("selected folder shows its verified name and complete My Drive hierarchy", async () => {
  const calls = [];
  const result = await folderLocation(
    drive(
      {
        selected: { id: "selected", name: "Capture projects", parents: ["tm"] },
        tm: { id: "tm", name: "Transcendence Media", parents: ["my-root"] },
        root: { id: "my-root", name: "My Drive" },
      },
      calls,
    ),
    "selected",
  );
  assert.equal(result.name, "Capture projects");
  assert.equal(
    result.location,
    "My Drive / Transcendence Media / Capture projects",
  );
  assert.equal(result.complete, true);
  assert.equal(result.url, "https://drive.google.com/drive/folders/selected");
  assert.deepEqual(calls, ["selected", "root", "tm"]);
});
test("restricted parent access retains folder identity and labels the path incomplete", async () => {
  const result = await folderLocation(
    drive({
      selected: {
        id: "selected",
        name: "Chosen folder",
        parents: ["private-parent"],
      },
    }),
    "selected",
  );
  assert.equal(result.name, "Chosen folder");
  assert.equal(result.location, "Chosen folder");
  assert.equal(result.complete, false);
});
test("shared drive hierarchy uses its verified drive name, never My Drive", async () => {
  const result = await folderLocation(
    drive({
      selected: {
        id: "selected",
        name: "Projects",
        parents: ["team"],
        driveId: "team",
      },
      team: { id: "team", name: "Team workspace", driveId: "team" },
    }),
    "selected",
  );
  assert.equal(result.location, "Shared drives / Team workspace / Projects");
  assert.equal(result.complete, true);
});
test("missing or mismatched folder metadata never supplies a folder name", async () => {
  await assert.rejects(folderLocation(drive({}), "selected"));
  await assert.rejects(
    folderLocation(
      drive({ selected: { id: "other", name: "Wrong folder" } }),
      "selected",
    ),
  );
  await assert.rejects(
    folderLocation(
      drive({ selected: { id: "selected", name: "Deleted", trashed: true } }),
      "selected",
    ),
  );
});
test("cyclic and excessively deep parent chains stop with an incomplete path", async () => {
  const calls = [];
  const result = await folderLocation(
    drive(
      { selected: { id: "selected", name: "Projects", parents: ["selected"] } },
      calls,
    ),
    "selected",
  );
  assert.equal(result.complete, false);
  const files = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      "f" + i,
      { id: "f" + i, name: "Folder " + i, parents: ["f" + (i + 1)] },
    ]),
  );
  calls.length = 0;
  assert.equal(
    (await folderLocation(drive(files, calls), "f0")).complete,
    false,
  );
  assert.equal(calls.length, 14);
});
