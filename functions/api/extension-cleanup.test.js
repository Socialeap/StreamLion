import test from "node:test";
import assert from "node:assert/strict";
import { extensionFixture } from "../../test/extension-fixture.js";
import { purgeExtensionState } from "../../ops/session-cleanup.js";
import { prepareExtensionDraft } from "../../server/extension-workbook.js";
test("extension cleanup removes expired copies and disconnected grants without touching valid access", async (t) => {
  const f = await extensionFixture();
  t.mock.method(globalThis, "fetch", f.fetch);
  const { principal } = await f.connect();
  await prepareExtensionDraft(f.env, principal, {
    kind: "project",
    fields: { title: "Temporary" },
  });
  f.db.prepare("UPDATE streamlion_extension_drafts_v1 SET expires_at=0").run();
  let result = await purgeExtensionState(f.env.GOOGLE_SESSIONS);
  assert.equal(result.extensionDraftsRemoved, 1);
  assert.equal(result.extensionGrantsRemoved, 0);
  f.db.prepare("DELETE FROM streamlion_google_sessions_v1").run();
  result = await purgeExtensionState(f.env.GOOGLE_SESSIONS);
  assert.equal(result.extensionGrantsRemoved, 1);
  assert.equal(result.extensionTokensRemoved, 2);
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM streamlion_extension_grants_v1")
      .get().n,
    0,
  );
});
