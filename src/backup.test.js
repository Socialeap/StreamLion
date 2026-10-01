import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  openLocalDatabase,
  loadWorkspace,
  getAudio,
  saveSiteCopy,
} from "./storage.js";
import {
  createBackup,
  inspectBackup,
  restoreBackup,
  digest,
} from "./backup.js";
import { makeRevision } from "./workbook.js";
import { validateFields } from "./project-schema.js";
import { readDraft } from "./drafts.js";
import { readWorkflow, validateWorkflow } from "./workflow.js";
const dom = new JSDOM("", { url: "https://app.example" });
globalThis.localStorage = dom.window.localStorage;
async function reset() {
  const db = await openLocalDatabase();
  await db.clear("workspace");
  await db.clear("audio");
  localStorage.clear();
  return db;
}
async function fixture() {
  const db = await reset();
  await db.put(
    "workspace",
    {
      version: 1,
      revision: 4,
      jobs: [{ id: "job", title: "Nassau synthetic", city: "Brooklyn" }],
      notes: [
        {
          id: "note",
          jobId: "remote-job",
          pendingBookId: "book-a",
          area: "Kitchen",
          text: "10 ft 4 3/32 in",
          audioId: "note",
          driveFileId: "reserved-file",
          audioUrl: "",
        },
      ],
    },
    "current",
  );
  await db.put(
    "audio",
    new Blob(["exact-original"], { type: "audio/webm;codecs=opus" }),
    "note",
  );
  const project = makeRevision(
    validateFields({ title: "Google synthetic" }),
    null,
    "remote-job",
  );
  await saveSiteCopy("book-a", { Projects: [project], Observations: [] });
  localStorage.setItem(
    "streamlion-draft-v1:local:project:draft-1",
    JSON.stringify({
      fields: { title: "Not finished", city: "Queens" },
      base: "unchanged",
    }),
  );
  localStorage.setItem(
    "streamlion-draft-v1:book-a:pending-write",
    JSON.stringify({
      tab: "Projects",
      revision: project,
      expected: null,
      signature: "same-operation",
    }),
  );
  localStorage.setItem(
    "streamlion-draft-v1:book-a:measurements:remote-job",
    JSON.stringify({
      room: "Kitchen",
      input: "length twelve...",
      entries: [],
      issues: [
        {
          raw: "ambiguous reading",
          message: "Give the exact reading with units.",
          source: "ambiguous reading",
        },
      ],
      checked: false,
    }),
  );
  localStorage.setItem("streamlion-selected-workbook-v1", "book-a");
  localStorage.setItem("google-token", "must-not-export");
  return createBackup();
}
test("complete backup restores drafts, site copies, outbox identities and exact media without Google calls", async () => {
  const backup = await fixture();
  assert.equal((await backup.text()).includes("must-not-export"), false);
  const inspection = await inspectBackup(backup);
  assert.deepEqual(inspection.summary, {
    projects: 1,
    notes: 1,
    files: 1,
    drafts: 3,
  });
  await reset();
  await restoreBackup(backup);
  assert.equal((await loadWorkspace()).jobs[0].title, "Nassau synthetic");
  assert.equal((await loadWorkspace()).notes[0].driveFileId, "reserved-file");
  assert.equal((await getAudio("note")).type, "audio/webm;codecs=opus");
  assert.equal(await (await getAudio("note")).text(), "exact-original");
  assert.equal(
    JSON.parse(localStorage.getItem("streamlion-draft-v1:book-a:pending-write"))
      .signature,
    "same-operation",
  );
  assert.equal(
    JSON.parse(
      localStorage.getItem(
        "streamlion-draft-v1:book-a:measurements:remote-job",
      ),
    ).issues[0].source,
    "ambiguous reading",
  );
  await restoreBackup(backup);
  assert.equal((await loadWorkspace()).jobs.length, 1);
  assert.equal((await loadWorkspace()).notes.length, 1);
});
test("damaged backups and record collisions preserve existing data and drafts", async () => {
  const backup = await fixture();
  const value = JSON.parse(await backup.text());
  value.payload.workspaces[0].value.jobs[0].title = "damaged";
  await assert.rejects(
    restoreBackup(new Blob([JSON.stringify(value)])),
    /damaged/,
  );
  const db = await openLocalDatabase();
  const current = await loadWorkspace();
  await db.put(
    "workspace",
    { ...current, jobs: [{ ...current.jobs[0], title: "Newer work" }] },
    "current",
  );
  await assert.rejects(restoreBackup(backup), /conflicts/);
  assert.equal((await loadWorkspace()).jobs[0].title, "Newer work");
  assert.equal(await (await getAudio("note")).text(), "exact-original");
});
test("a localStorage quota failure rolls back the IndexedDB restore and added drafts", async () => {
  const backup = await fixture();
  await reset();
  const original = globalThis.localStorage;
  let writes = 0;
  globalThis.localStorage = {
    get length() {
      return original.length;
    },
    key: (index) => original.key(index),
    getItem: (key) => original.getItem(key),
    removeItem: (key) => original.removeItem(key),
    setItem: (key, value) => {
      if (++writes === 2) throw new Error("quota exceeded");
      original.setItem(key, value);
    },
  };
  try {
    await assert.rejects(restoreBackup(backup), /quota/);
    assert.equal((await loadWorkspace()).jobs.length, 0);
    assert.equal(await getAudio("note"), undefined);
    assert.equal(original.length, 0);
  } finally {
    globalThis.localStorage = original;
  }
});
test("backup file integrity and missing media are checked before any storage changes", async () => {
  const backup = await fixture();
  const value = JSON.parse(await backup.text());
  value.payload.media[0].sha256 = "wrong";
  value.sha256 = await digest(
    new TextEncoder().encode(JSON.stringify(value.payload)),
  );
  await assert.rejects(
    inspectBackup(new Blob([JSON.stringify(value)])),
    /damaged/,
  );
  const db = await openLocalDatabase();
  await db.delete("audio", "note");
  await assert.rejects(createBackup(), /missing/);
});
test("malformed nested drafts cannot replace a usable device workspace", async () => {
  const backup = await fixture();
  const value = JSON.parse(await backup.text());
  const draft = value.payload.deviceStrings.find((entry) =>
    entry.key.includes(":measurements:"),
  );
  draft.value = JSON.stringify({
    room: "Kitchen",
    entries: null,
    issues: [],
    checked: true,
  });
  value.sha256 = await digest(
    new TextEncoder().encode(JSON.stringify(value.payload)),
  );
  await assert.rejects(
    restoreBackup(new Blob([JSON.stringify(value)])),
    /measurement draft/,
  );
  assert.equal((await loadWorkspace()).jobs[0].title, "Nassau synthetic");
  draft.value =
    '{"room":"Kitchen","constructor":{},"entries":[],"issues":[],"checked":false}';
  value.sha256 = await digest(
    new TextEncoder().encode(JSON.stringify(value.payload)),
  );
  await assert.rejects(
    inspectBackup(new Blob([JSON.stringify(value)])),
    /Invalid backup field/,
  );
});
test("unfinished local and Google checklist drafts round-trip without completing or changing them", async () => {
  await fixture();
  const baseline = readWorkflow([], { id: "job" });
  const plan = {
    ...baseline,
    requirements: [
      {
        id: "requirement",
        label: " Capture rear room ",
        area: " Back room ",
        state: "blocked",
        reason: "",
        evidence: ["note"],
      },
    ],
    // Autosaved wording may exceed the saved-record limit until it is edited.
    siteLessons: "Still editing. ".repeat(160),
  };
  const drafts = [
    ["local:checklist:job", { plan, base: "" }],
    [
      "book-a:checklist:remote-job",
      { plan, base: JSON.stringify(baseline, null, 2) },
    ],
  ].map(([key, value]) => [key, JSON.stringify(value, null, 2)]);
  for (const [key, value] of drafts)
    localStorage.setItem(`streamlion-draft-v1:${key}`, value);
  const backup = await createBackup();
  assert.equal((await inspectBackup(backup)).summary.drafts, 5);
  await reset();
  await restoreBackup(backup);
  for (const [key, value] of drafts) {
    assert.equal(localStorage.getItem(`streamlion-draft-v1:${key}`), value);
    const restored = readDraft(key);
    assert.equal(restored.plan.requirements[0].reason, "");
    assert.throws(() => validateWorkflow(restored.plan), /Explain why/);
  }
});
test("malformed checklist plans and baselines are rejected before any restore changes", async () => {
  const backup = await fixture();
  const value = JSON.parse(await backup.text());
  const plan = readWorkflow([], { id: "job" });
  const key = "streamlion-draft-v1:local:checklist:job";
  const original = JSON.stringify({ plan, base: "" });
  localStorage.setItem(key, original);
  const draft = { key, value: original };
  value.payload.deviceStrings.push(draft);
  const requirement = {
    id: "req",
    label: "Capture",
    area: "",
    state: "todo",
    reason: "",
    evidence: [],
  };
  for (const invalid of [
    { plan: null, base: "" },
    { plan, base: {} },
    { plan: { ...plan, kind: "unknown" }, base: "" },
    { plan: { ...plan, visit: "unknown" }, base: "" },
    { plan: { ...plan, siteLessons: [] }, base: "" },
    { plan: { ...plan, requirements: [requirement, requirement] }, base: "" },
    {
      plan: {
        ...plan,
        requirements: [{ ...requirement, evidence: [null] }],
      },
      base: "",
    },
    { plan, base: "{broken" },
    { plan, base: JSON.stringify({ ...plan, delivery: "unknown" }) },
  ]) {
    draft.value = JSON.stringify(invalid);
    value.sha256 = await digest(
      new TextEncoder().encode(JSON.stringify(value.payload)),
    );
    await assert.rejects(
      restoreBackup(new Blob([JSON.stringify(value)])),
      /checklist draft/,
    );
    assert.equal((await loadWorkspace()).jobs[0].title, "Nassau synthetic");
    assert.equal(await (await getAudio("note")).text(), "exact-original");
    assert.equal(localStorage.getItem(key), original);
  }
});
test.after(() => dom.window.close());
