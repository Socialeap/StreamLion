import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWNER_EMAIL } from "../../server/admin-data.js";

test("owner AI test grant is offline, short-lived, account/project bound and never overwrites", () => {
  const dir = mkdtempSync(join(tmpdir(), "streamlion-ai-qa-"));
  try {
    const now = Date.now(),
      identity = join(dir, "identity.json"),
      workspace = join(dir, "workspace.json"),
      out = join(dir, "grant.json");
    writeFileSync(
      identity,
      JSON.stringify({
        mode: "live",
        enabled: 1,
        policy_enabled: 1,
        email: OWNER_EMAIL,
        google_subject: "qa-subject",
      }),
    );
    writeFileSync(
      workspace,
      JSON.stringify({
        version: 1,
        scope: "google-workspace",
        mode: "live",
        origin: "https://streamlion.transcendencemedia.com",
        subject: "qa-subject",
        issuedAt: now - 1000,
        expiresAt: now + 3600000,
        reason: "Workspace QA",
      }),
    );
    const run = (extra = []) =>
      spawnSync(
        process.execPath,
        [
          new URL("../../scripts/prepare-owner-ai-qa.mjs", import.meta.url)
            .pathname,
          "--identity-file",
          identity,
          "--workspace-file",
          workspace,
          "--workbook-id",
          "synthetic-book",
          "--project-id",
          "synthetic-project",
          "--out",
          out,
          ...extra,
        ],
        { encoding: "utf8" },
      );
    const first = run();
    assert.equal(first.status, 0);
    assert.doesNotMatch(first.stdout, /qa-subject/);
    const grant = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(grant.subject, "qa-subject");
    assert.equal(grant.projectId, "synthetic-project");
    assert.equal(grant.workbookId, "synthetic-book");
    assert.equal(grant.expiresAt - grant.issuedAt, 15 * 60000);
    assert.match(grant.requestId, /^[0-9a-f-]{36}$/);
    assert.notEqual(run().status, 0);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), grant);
    rmSync(out);
    assert.notEqual(run(["--minutes", "31"]).status, 0);
    writeFileSync(
      workspace,
      JSON.stringify({
        version: 1,
        scope: "google-workspace",
        mode: "live",
        origin: "https://streamlion.transcendencemedia.com",
        subject: "someone-else",
        issuedAt: now - 1000,
        expiresAt: now + 3600000,
        reason: "Workspace QA",
      }),
    );
    assert.notEqual(run().status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
