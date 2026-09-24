import test from "node:test";
import assert from "node:assert/strict";
import { validateFields, parseIntake, legacyFields } from "./project-schema.js";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  makeRevision,
  rowFor,
  readRecords,
  assertUnchanged,
  validateNote,
} from "./workbook.js";
const fields = () =>
  validateFields({
    title: "Test capture",
    reference: "APS46231",
    scope: "Wall 10 ft 4 3/32 in",
    offeredFee: "250",
    currency: "USD",
  });
test("intake preserves exact scope, references and zero without creating payments", () => {
  const f = parseIntake(
    JSON.stringify({
      schemaVersion: 1,
      kind: "streamlion.project",
      fields: { ...fields(), propertySizeSqFt: "0" },
    }),
  );
  assert.equal(f.scope, "Wall 10 ft 4 3/32 in");
  assert.equal(f.reference, "APS46231");
  assert.equal(f.paidAmount, "");
  assert.equal(f.propertySizeSqFt, "0");
  assert.throws(() => parseIntake('{"schemaVersion":2}'));
  assert.throws(() => validateFields({ title: "x", admin: true }));
  assert.throws(() =>
    validateFields({ title: "x", document1Url: "javascript:alert(1)" }),
  );
  assert.throws(() =>
    validateFields({
      title: "x",
      startLocal: "2026-02-30T10:00",
      timeZone: "UTC",
    }),
  );
  assert.throws(() => validateFields({ title: "x", offeredFee: "250" }));
  assert.equal(
    legacyFields({ title: "x", offeredCents: 0 }).offeredFee,
    "0.00",
  );
});
test("revisions survive sorted rows and identical retries; concurrent forks fail visibly", () => {
  const a = makeRevision(fields(), null, "job-a"),
    b = makeRevision({ ...fields(), scope: "Changed" }, a);
  const rows = [
    PROJECT_HEADERS,
    rowFor(b, PROJECT_HEADERS),
    rowFor(a, PROJECT_HEADERS),
    rowFor(b, PROJECT_HEADERS),
  ];
  assert.equal(readRecords(rows, PROJECT_HEADERS)[0].scope, "Changed");
  const fork = makeRevision({ ...fields(), scope: "Other" }, a);
  assert.throws(
    () =>
      readRecords([...rows, rowFor(fork, PROJECT_HEADERS)], PROJECT_HEADERS),
    /Concurrent/,
  );
  assert.throws(
    () =>
      readRecords(
        [PROJECT_HEADERS, rowFor(b, PROJECT_HEADERS)],
        PROJECT_HEADERS,
      ),
    /Broken/,
  );
  assert.throws(() => assertUnchanged(b, a), /changed/);
});
test("archived project stays in the revision chain and can be restored", () => {
  const original = makeRevision(fields(), null, "project-a", "reviewed");
  const archived = makeRevision(fields(), original, "project-a", "archived");
  const restored = makeRevision(fields(), archived, "project-a", "draft");
  assert.equal(
    readRecords(
      [
        PROJECT_HEADERS,
        rowFor(original, PROJECT_HEADERS),
        rowFor(archived, PROJECT_HEADERS),
      ],
      PROJECT_HEADERS,
    )[0].reviewState,
    "archived",
  );
  assert.equal(
    readRecords(
      [
        PROJECT_HEADERS,
        rowFor(original, PROJECT_HEADERS),
        rowFor(archived, PROJECT_HEADERS),
        rowFor(restored, PROJECT_HEADERS),
      ],
      PROJECT_HEADERS,
    )[0].reviewState,
    "draft",
  );
  const observation = makeRevision(
    validateNote({
      projectId: "project-a",
      area: "Lobby",
      text: "Original note",
    }),
    null,
    "note-a",
  );
  assert.throws(
    () =>
      readRecords(
        [
          NOTE_HEADERS,
          rowFor({ ...observation, reviewState: "archived" }, NOTE_HEADERS),
        ],
        NOTE_HEADERS,
      ),
    /metadata/,
  );
});
test("tampered headers and conflicting duplicate revision never overwrite", () => {
  const a = makeRevision(fields(), null, "job-a");
  assert.throws(
    () => readRecords([["Wrong"], rowFor(a, PROJECT_HEADERS)], PROJECT_HEADERS),
    /headers/,
  );
  assert.throws(
    () =>
      readRecords(
        [
          PROJECT_HEADERS,
          rowFor(a, PROJECT_HEADERS),
          rowFor({ ...a, title: "Other" }, PROJECT_HEADERS),
        ],
        PROJECT_HEADERS,
      ),
    /Conflicting/,
  );
});
test("annotation source wording remains distinct from corrected text", () => {
  const n = validateNote({
    projectId: "a",
    area: "Office 1",
    text: "Corrected 3/32 in",
    sourceText: "Original wording",
  });
  const r = makeRevision(n, null, "note-a");
  assert.equal(
    readRecords([NOTE_HEADERS, rowFor(r, NOTE_HEADERS)], NOTE_HEADERS)[0]
      .sourceText,
    "Original wording",
  );
  assert.throws(() => validateNote({ projectId: "a", area: "", text: "x" }));
});

test("plugin and documentation share the executable field contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const { PROJECT_FIELDS } = await import("./project-schema.js");
  const a = JSON.parse(
    await readFile(new URL("../docs/field-map.json", import.meta.url)),
  );
  const b = JSON.parse(
    await readFile(
      new URL(
        "../plugin/skills/instructions/references/field-map.json",
        import.meta.url,
      ),
    ),
  );
  assert.deepEqual(a, b);
  assert.deepEqual(a.fields, PROJECT_FIELDS);
  assert.deepEqual(a.workbook.Projects, PROJECT_HEADERS);
  assert.deepEqual(a.workbook.Observations, NOTE_HEADERS);
});
