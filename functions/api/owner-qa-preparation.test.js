import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const script = new URL(
  "../../scripts/prepare-owner-core-qa.mjs",
  import.meta.url,
);
test("offline QA preparation binds the verified enrolled owner and protects its output without printing identity", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "owner-qa-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "identity.json"),
    out = join(dir, "grant.json");
  const identity = {
    mode: "live",
    google_subject: "owner-synthetic",
    email: "shakoure@transcendencemedia.com",
    enabled: 1,
    policy_enabled: 1,
  };
  await writeFile(input, JSON.stringify(identity));
  const run = () =>
    spawnSync(
      process.execPath,
      [script.pathname, "--identity-file", input, "--out", out],
      { encoding: "utf8" },
    );
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("owner-synthetic"), false);
  const grant = JSON.parse(await readFile(out, "utf8"));
  assert.equal(grant.subject, "owner-synthetic");
  assert.equal(grant.scope, "google-workspace");
  assert.equal(grant.expiresAt - grant.issuedAt, 7200000);
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  assert.notEqual(run().status, 0, "existing files must not be overwritten");
  for (const change of [
    { email: "other@example.com" },
    { mode: "test" },
    { enabled: 0 },
    { policy_enabled: 0 },
    { google_subject: "" },
  ]) {
    await rm(out);
    await writeFile(input, JSON.stringify({ ...identity, ...change }));
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    await assert.rejects(() => stat(out));
    await writeFile(out, "preserve");
  }
});
