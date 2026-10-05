import test from "node:test";
import assert from "node:assert/strict";
import { extensionFixture } from "../../test/extension-fixture.js";
import {
  listExtensionProjects,
  getExtensionProject,
  getExtensionDraft,
  prepareExtensionDraft,
  saveExtensionDraft,
} from "../../server/extension-workbook.js";
import {
  makeRevision,
  rowFor,
  PROJECT_HEADERS,
  NOTE_HEADERS,
} from "../../src/workbook.js";
import { validateFields } from "../../src/project-schema.js";
import { hash } from "../../server/google-auth.js";
import { extensionSnapshot } from "../../server/extension-workbook.js";
async function setup(t) {
  const f = await extensionFixture();
  t.mock.method(globalThis, "fetch", f.fetch);
  const { principal } = await f.connect();
  return { ...f, principal, fixture: f };
}
test("oversized Google responses are cancelled before the extension parses or saves them", async (t) => {
  const f = await setup(t);
  let reads = 0,
    cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream(
          {
            pull(controller) {
              reads++;
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
      ),
  );
  await assert.rejects(() => extensionSnapshot(f.env, f.principal), {
    status: 413,
  });
  assert.equal(reads, 9);
  assert.equal(cancelled, true);
  assert.equal(f.fixture.writes, 0);
});

test("draft is encrypted, bound to one grant, and not a Google save; review confirmation is required", async (t) => {
  const f = await setup(t),
    draft = await prepareExtensionDraft(f.env, f.principal, {
      kind: "project",
      fields: {
        title: "  Nassau Street  ",
        city: "Freeport",
        scope: "=not a formula",
      },
    });
  assert.equal(draft.structuredContent.revision.title, "Nassau Street");
  assert.equal(f.fixture.writes, 0);
  assert.ok(
    !f.db
      .prepare("SELECT payload FROM streamlion_extension_drafts_v1")
      .get()
      .payload.includes("Nassau Street"),
  );
  const args = {
    draftId: draft.structuredContent.draftId,
    confirmation: draft._meta.confirmation,
    reviewed: false,
  };
  await assert.rejects(
    () =>
      saveExtensionDraft(f.env, f.principal, {
        ...args,
        confirmation: "wrong",
      }),
    /Open this review/,
  );
  await assert.rejects(
    () =>
      saveExtensionDraft(
        f.env,
        { ...f.principal, grant: { ...f.principal.grant, grant_id: "other" } },
        args,
      ),
    /expired/,
  );
  const receipt = await saveExtensionDraft(f.env, f.principal, args);
  assert.equal(f.fixture.writes, 1);
  assert.equal(receipt.revisionId, draft.structuredContent.revision.revisionId);
  assert.equal(
    (await listExtensionProjects(f.env, f.principal)).projects.length,
    1,
  );
  const read = await getExtensionProject(f.env, f.principal, receipt.recordId);
  assert.equal(read.project.scope, "=not a formula");
  await saveExtensionDraft(f.env, f.principal, args);
  assert.equal(f.fixture.writes, 1, "identical retry does not append twice");
});
test("timeout after accepted append is reconciled with same identity and save state", async (t) => {
  const f = await setup(t),
    draft = await prepareExtensionDraft(f.env, f.principal, {
      kind: "project",
      fields: { title: "Retry job" },
    });
  const args = {
    draftId: draft.structuredContent.draftId,
    confirmation: draft._meta.confirmation,
    reviewed: true,
  };
  f.fixture.failAfterAppend();
  await assert.rejects(
    () => saveExtensionDraft(f.env, f.principal, args),
    /timeout/,
  );
  assert.equal(
    (await getExtensionDraft(f.env, f.principal, args.draftId)).payload
      .writeAttempted,
    true,
  );
  await assert.rejects(
    () => saveExtensionDraft(f.env, f.principal, { ...args, reviewed: false }),
    /same save choice/,
  );
  await saveExtensionDraft(f.env, f.principal, args);
  assert.equal(f.fixture.writes, 1);
});
test("stale project baseline rejects a save; shared leases prevent overlapping MCP writes", async (t) => {
  const f = await setup(t),
    base = makeRevision(validateFields({ title: "Existing" }));
  f.sheets.Projects.push(rowFor(base, PROJECT_HEADERS));
  const draft = await prepareExtensionDraft(f.env, f.principal, {
    kind: "project",
    recordId: base.recordId,
    expectedRevisionId: base.revisionId,
    fields: { city: "Freeport" },
  });
  const args = {
    draftId: draft.structuredContent.draftId,
    confirmation: draft._meta.confirmation,
    reviewed: false,
  };
  f.db
    .prepare(
      "INSERT INTO streamlion_extension_locks_v1 VALUES ('book-a','other',?)",
    )
    .run(Date.now() + 60000);
  await assert.rejects(
    () => saveExtensionDraft(f.env, f.principal, args),
    /Another save/,
  );
  f.db.prepare("DELETE FROM streamlion_extension_locks_v1").run();
  f.sheets.Projects.push(
    rowFor(
      makeRevision(
        validateFields({
          ...Object.fromEntries(
            PROJECT_HEADERS.slice(5).map((k) => [k, base[k]]),
          ),
          title: "Changed elsewhere",
        }),
        base,
      ),
      PROJECT_HEADERS,
    ),
  );
  await assert.rejects(
    () => saveExtensionDraft(f.env, f.principal, args),
    (error) => {
      assert.match(error.message, /changed in Google/);
      assert.equal(error.safeToEdit, true);
      return true;
    },
  );
  assert.equal(f.fixture.writes, 0);
  assert.equal(
    (await getExtensionDraft(f.env, f.principal, args.draftId)).payload
      .saveReview,
    undefined,
  );
});
test("archived and foreign projects cannot receive observations; ambiguous measurements cannot be reviewed", async (t) => {
  const f = await setup(t),
    base = makeRevision(validateFields({ title: "Kitchen job" }));
  f.sheets.Projects.push(rowFor(base, PROJECT_HEADERS));
  await assert.rejects(
    () =>
      prepareExtensionDraft(f.env, f.principal, {
        kind: "note",
        projectId: "foreign",
        area: "Kitchen",
        text: "Door blocked",
      }),
    /not found/,
  );
  const draft = await prepareExtensionDraft(f.env, f.principal, {
    kind: "measurement",
    projectId: base.recordId,
    room: "Kitchen",
    raw: "Length twelve",
  });
  const args = {
    draftId: draft.structuredContent.draftId,
    confirmation: draft._meta.confirmation,
    reviewed: true,
  };
  await assert.rejects(
    () => saveExtensionDraft(f.env, f.principal, args),
    /Clarify every reading/,
  );
  await saveExtensionDraft(f.env, f.principal, { ...args, reviewed: false });
  assert.equal(f.sheets.Observations.length, 2);
  f.sheets.Projects.push(
    rowFor(
      makeRevision(
        validateFields(
          Object.fromEntries(PROJECT_HEADERS.slice(5).map((k) => [k, base[k]])),
        ),
        base,
        base.recordId,
        "archived",
      ),
      PROJECT_HEADERS,
    ),
  );
  assert.equal(
    (await listExtensionProjects(f.env, f.principal)).projects.length,
    0,
  );
  await assert.rejects(
    () => getExtensionProject(f.env, f.principal, base.recordId),
    /not found/,
  );
});
test("corrections retain original wording; malformed schemas fail without writing", async (t) => {
  const f = await setup(t),
    p = makeRevision(validateFields({ title: "Job" }));
  f.sheets.Projects.push(rowFor(p, PROJECT_HEADERS));
  const n = makeRevision({
    projectId: p.recordId,
    area: "Lobby",
    text: "The door is blocked",
    sourceText: "door blocked original",
    audioUrl: "https://drive.google.com/example",
  });
  f.sheets.Observations.push(rowFor(n, NOTE_HEADERS));
  const draft = await prepareExtensionDraft(f.env, f.principal, {
    kind: "note",
    projectId: p.recordId,
    recordId: n.recordId,
    expectedRevisionId: n.revisionId,
    area: "Lobby",
    text: "Door access restored",
    sourceText: "replacement original",
  });
  assert.equal(
    draft.structuredContent.revision.sourceText,
    "door blocked original",
  );
  assert.equal(draft.structuredContent.revision.audioUrl, n.audioUrl);
  f.sheets.Projects[0].push("unrecognized");
  await assert.rejects(
    () => listExtensionProjects(f.env, f.principal),
    /headers do not match/,
  );
  assert.equal(f.fixture.writes, 0);
});
test("read-only grants, expired drafts and invalid confirm keys fail closed", async (t) => {
  const f = await setup(t);
  await assert.rejects(
    () =>
      prepareExtensionDraft(
        f.env,
        {
          ...f.principal,
          grant: { ...f.principal.grant, scope: "records.read" },
        },
        { kind: "project", fields: { title: "No write" } },
      ),
    /permission/,
  );
  const draft = await prepareExtensionDraft(f.env, f.principal, {
    kind: "project",
    fields: { title: "Expiry" },
  });
  f.db.prepare("UPDATE streamlion_extension_drafts_v1 SET expires_at=0").run();
  await assert.rejects(
    () =>
      saveExtensionDraft(f.env, f.principal, {
        draftId: draft.structuredContent.draftId,
        confirmation: draft._meta.confirmation,
        reviewed: false,
      }),
    /expired/,
  );
  assert.equal(f.fixture.writes, 0);
});
