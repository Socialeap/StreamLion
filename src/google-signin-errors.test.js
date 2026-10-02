import test from "node:test";
import assert from "node:assert/strict";
import { googleSignInFailure } from "./google-signin-errors.js";

test("sign-in messages distinguish owner setup from retryable failures", () => {
  assert.match(googleSignInFailure("failed", "client_rejected"), /app owner/);
  assert.match(
    googleSignInFailure("failed", "session_save"),
    /code session_save/,
  );
  assert.match(googleSignInFailure("failed", "state_mismatch"), /Another tab/);
  assert.match(
    googleSignInFailure("cancelled", "client_rejected"),
    /cancelled/,
  );
});
test("untrusted URL reasons never become displayed error text", () => {
  const message = googleSignInFailure("failed", "private-token-value");
  assert.doesNotMatch(message, /private-token-value/);
  assert.match(message, /drafts are preserved/);
  assert.doesNotThrow(() => googleSignInFailure("failed", "__proto__"));
});
