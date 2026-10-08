import test from "node:test";
import assert from "node:assert/strict";
import {
  CoordinationGoogle,
  EVENT_HEADERS,
  ARCHIVE_HEADERS,
} from "../../server/coordination-google.js";
import { PROJECT_HEADERS, NOTE_HEADERS } from "../../src/workbook.js";
import { newClientJob, stableJSON } from "../../src/client-workflow.js";
import {
  INTAKE_PRESETS,
  reviseIntakeTemplate,
} from "../../src/intake-templates.js";
const connection = {
  id: "connection",
  google_subject: "a",
  workbook_id: "book",
  folder_id: "folder",
  mode: "test",
};
const job = () => ({
  ...newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 1,
  }),
  state: "closed",
  closedAt: 2,
  archiveAt: 3,
});
test("coordination history accepts identical retries but rejects forks and another provider", async () => {
  const google = new CoordinationGoogle(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: "synthetic-signing-key" },
      connection,
    ),
    j = job();
  const event = {
    id: "event",
    jobId: j.id,
    revision: 0,
    parent: -1,
    at: 1,
    actor: "provider",
    action: "create",
    job: j,
  };
  const row = [
    "event",
    j.id,
    0,
    -1,
    1,
    "provider",
    "create",
    stableJSON(j),
    await google.signature(event),
  ];
  let rows = [
    [PROJECT_HEADERS],
    [NOTE_HEADERS],
    [EVENT_HEADERS, row, row],
    [ARCHIVE_HEADERS],
  ];
  google.json = async () => ({
    valueRanges: rows.map((values) => ({ values })),
  });
  assert.equal((await google.snapshot()).heads.size, 1);
  rows[2].push([
    "fork",
    j.id,
    0,
    -1,
    1,
    "provider",
    "create",
    stableJSON(j),
    await google.signature({ ...event, id: "fork" }),
  ]);
  await assert.rejects(() => google.snapshot(), /Concurrent/);
  rows[2] = [
    EVENT_HEADERS,
    [
      ...row.slice(0, 7),
      stableJSON({ ...j, provider: "b" }),
      await google.signature({ ...event, job: { ...j, provider: "b" } }),
    ],
  ];
  await assert.rejects(() => google.snapshot(), /another provider/);
  rows[2] = [
    EVENT_HEADERS,
    [
      ...row.slice(0, 7),
      stableJSON({ ...j, fields: { ...j.fields, scope: "Forged" } }),
      row[8],
    ],
  ];
  await assert.rejects(() => google.snapshot(), /signature/);
  rows[2] = [EVENT_HEADERS, row.slice(0, 8)];
  await assert.rejects(() => google.snapshot(), /signature/);
});
test("signed template history stays separate from jobs and rejects a client-authored template", async () => {
  const google = new CoordinationGoogle(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: "synthetic-signing-key" },
    connection,
  );
  const record = reviseIntakeTemplate(
    null,
    {
      id: "intake-capture",
      provider: "a",
      expectedVersion: 0,
      config: INTAKE_PRESETS[0],
    },
    1,
  );
  const event = {
    id: "template-one",
    jobId: record.id,
    revision: 0,
    parent: -1,
    at: 1,
    actor: "provider",
    action: "template-save",
    job: record,
  };
  const rowForEvent = async (value) => [
    value.id,
    value.jobId,
    value.revision,
    value.parent,
    value.at,
    value.actor,
    value.action,
    stableJSON(value.job),
    await google.signature(value),
  ];
  const rows = [
    [PROJECT_HEADERS],
    [NOTE_HEADERS],
    [EVENT_HEADERS, await rowForEvent(event)],
    [ARCHIVE_HEADERS],
  ];
  google.json = async () => ({
    valueRanges: rows.map((values) => ({ values })),
  });
  const snapshot = await google.snapshot();
  assert.equal(snapshot.heads.size, 0);
  assert.equal(snapshot.templates.get(record.id).config.name, "3D capture");
  rows[2][1] = await rowForEvent({ ...event, actor: "client" });
  await assert.rejects(
    () => google.snapshot(),
    /Invalid service template history/,
  );
  rows[2][1] = await rowForEvent({
    ...event,
    job: { ...record, provider: "b" },
  });
  await assert.rejects(() => google.snapshot(), /another provider/);
  rows[2][1] = await rowForEvent({
    ...event,
    job: {
      ...record,
      config: { ...record.config, defaults: { paidAmount: "900" } },
    },
  });
  await assert.rejects(() => google.snapshot(), /Unsupported/);
});
test("private folder checks reject public or delegated access", async () => {
  const google = new CoordinationGoogle({}, connection);
  google.json = async () => ({
    ownedByMe: true,
    mimeType: "application/vnd.google-apps.folder",
    capabilities: { canAddChildren: true },
    permissions: [
      { type: "user", role: "owner" },
      { type: "anyone", role: "reader" },
    ],
  });
  await assert.rejects(() => google.privateFolder(), /private provider/);
});
test("archive retries reuse a reserved Drive identity and verify bytes and index before success", async () => {
  const google = new CoordinationGoogle(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: "synthetic-signing-key" },
      connection,
    ),
    j = job(),
    files = new Map(),
    index = [ARCHIVE_HEADERS];
  let uncertain = true,
    corrupt = false,
    uploads = 0;
  google.privateFolder = async () => {};
  google.snapshot = async () => ({
    events: new Map([
      [
        "created",
        {
          id: "created",
          jobId: j.id,
          revision: 0,
          parent: -1,
          at: j.updatedAt,
          actor: "provider",
          action: "create",
          job: j,
        },
      ],
    ]),
    projects: { revisions: [] },
    notes: { revisions: [] },
    rows: [[], [], [], index],
  });
  google.json = async (url, options) => {
    if (url.includes("generateIds")) return { ids: ["archive-fixed"] };
    if (url.includes("upload")) {
      uploads++;
      files.set(
        "archive-fixed",
        options.body
          .split("Content-Type: application/json\r\n\r\n")[2]
          .split("\r\n--streamlion-")[0],
      );
      if (uncertain) {
        uncertain = false;
        throw new Error("timeout after upload");
      }
      return { id: "archive-fixed" };
    }
    throw new Error("unexpected fixture request");
  };
  google.callMetadata = async (id) => (files.has(id) ? { id } : null);
  google.call = async () =>
    new Response(corrupt ? "altered" : files.get("archive-fixed"));
  google.append = async (_tab, row) => index.push(row);
  const plan = await google.archivePlan(j);
  await assert.rejects(() => google.archive(j, "archive-op", plan), /timeout/);
  corrupt = true;
  await assert.rejects(
    () => google.archive(j, "archive-op", plan),
    /integrity/,
  );
  assert.equal(index.length, 1);
  corrupt = false;
  assert.equal(await google.archive(j, "archive-op", plan), "archive-fixed");
  assert.equal(uploads, 1);
  assert.equal(index.length, 2);
});
