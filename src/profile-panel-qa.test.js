import test from "node:test";
import assert from "node:assert/strict";
import { profilePanelQa } from "../server/profile-panel-qa.js";
const now = 1700000000000;
const identity = { google_subject: "second", email: "second@example.com" };
const grant = {
  version: 1,
  scope: "profile-panel",
  subject: "second",
  email: identity.email,
  issuedAt: now,
  expiresAt: now + 3600000,
};
const env = {
  STREAMLION_PAYMENTS_MODE: "live",
  STREAMLION_CHECKOUT_MODE: "paused",
  GOOGLE_AUTH_ORIGIN: "https://streamlion.transcendencemedia.com",
  STREAMLION_PROFILE_PANEL_QA: JSON.stringify(grant),
};
test("profile QA binds the exact identity, never another account or a wildcard", () => {
  assert.deepEqual(profilePanelQa(env, identity, now), {
    scope: "profile-panel",
    expiresAt: grant.expiresAt,
  });
  for (const other of [
    null,
    { ...identity, google_subject: "first" },
    { ...identity, email: "first@example.com" },
  ])
    assert.equal(profilePanelQa(env, other, now), null);
  for (const patch of [
    { subject: "*" },
    { scope: "google-workspace" },
    { expiresAt: now + 3600001 },
    { issuedAt: now + 1 },
    { version: 2 },
  ])
    assert.equal(
      profilePanelQa(
        {
          ...env,
          STREAMLION_PROFILE_PANEL_QA: JSON.stringify({ ...grant, ...patch }),
        },
        identity,
        now,
      ),
      null,
    );
});
test("profile QA expires and fails closed for missing/malformed or unsafe configuration", () => {
  assert.equal(profilePanelQa(env, identity, grant.expiresAt), null);
  for (const patch of [
    { STREAMLION_PROFILE_PANEL_QA: "bad" },
    { STREAMLION_PROFILE_PANEL_QA: "" },
    { STREAMLION_CHECKOUT_MODE: "open" },
    { STREAMLION_PAYMENTS_MODE: "test" },
    { GOOGLE_AUTH_ORIGIN: "https://other.example" },
  ])
    assert.equal(profilePanelQa({ ...env, ...patch }, identity, now), null);
});
