import test from "node:test";
import assert from "node:assert/strict";
import { DAY } from "./client-workflow.js";
import {
  coordinationDraftKey,
  readCoordinationDraft,
  writeCoordinationDraft,
  clearCoordinationDrafts,
} from "./coordination-drafts.js";
function memoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i],
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
}
const job = {
  id: "one",
  revision: 2,
  fields: { scope: "Agreed wording", agreedFee: "100" },
};
test("device autosave restores exact unsaved wording and its original conflict base", () => {
  const storage = memoryStorage(),
    key = coordinationDraftKey("client", "client", job.id);
  writeCoordinationDraft(
    key,
    job,
    ["scope"],
    { scope: "Unsaved 6 7/16 inches", agreedFee: "secret" },
    job.fields,
    2,
    storage,
  );
  assert.doesNotMatch(storage.getItem(key), /secret|agreedFee/);
  const latest = {
    ...job,
    revision: 3,
    fields: { ...job.fields, scope: "Other party's new wording" },
  };
  const restored = readCoordinationDraft(key, latest, ["scope"], storage);
  assert.equal(restored.fields.scope, "Unsaved 6 7/16 inches");
  assert.equal(restored.baseFields.scope, "Agreed wording");
  assert.equal(restored.revision, 2);
  assert.equal(restored.fields.agreedFee, "100");
});
test("different jobs, accounts and roles cannot inherit a draft; client sign-out preserves provider drafts", () => {
  const storage = memoryStorage();
  for (const [role, scope] of [
    ["client", "client"],
    ["provider", "a"],
    ["provider", "b"],
  ]) {
    const key = coordinationDraftKey(role, scope, job.id);
    writeCoordinationDraft(
      key,
      job,
      ["scope"],
      { scope: role + scope },
      job.fields,
      2,
      storage,
    );
  }
  assert.equal(
    readCoordinationDraft(
      coordinationDraftKey("provider", "c", job.id),
      job,
      ["scope"],
      storage,
    ),
    null,
  );
  assert.equal(
    readCoordinationDraft(
      coordinationDraftKey("client", "client", "two"),
      { ...job, id: "two" },
      ["scope"],
      storage,
    ),
    null,
  );
  clearCoordinationDrafts("client", "client", storage);
  assert.equal(storage.length, 2);
  assert.equal(
    readCoordinationDraft(
      coordinationDraftKey("provider", "b", job.id),
      job,
      ["scope"],
      storage,
    ).fields.scope,
    "providerb",
  );
});
test("expired, malformed, closed-job and over-permission drafts are rejected", () => {
  const storage = memoryStorage(),
    key = coordinationDraftKey("client", "client", job.id);
  writeCoordinationDraft(
    key,
    job,
    ["scope"],
    { scope: "Edit" },
    job.fields,
    2,
    storage,
  );
  const valid = JSON.parse(storage.getItem(key));
  for (const saved of [
    { ...valid, savedAt: Date.now() - 8 * DAY },
    { ...valid, savedAt: Date.now() + DAY },
    { ...valid, revision: -1 },
    { ...valid, fields: { scope: "x".repeat(6001) } },
    { ...valid, fields: { scope: "Edit", agreedFee: "1000" } },
    { ...valid, baseFields: { scope: [] } },
  ]) {
    storage.setItem(key, JSON.stringify(saved));
    assert.equal(readCoordinationDraft(key, job, ["scope"], storage), null);
  }
  storage.setItem(key, JSON.stringify(valid));
  assert.equal(
    readCoordinationDraft(key, { ...job, closedAt: 1 }, ["scope"], storage),
    null,
  );
  storage.setItem(key, "{broken");
  assert.equal(readCoordinationDraft(key, job, ["scope"], storage), null);
});
