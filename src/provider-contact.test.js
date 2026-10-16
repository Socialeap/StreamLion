import test from "node:test";
import assert from "node:assert/strict";
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const { PROVIDER_CONTACT_KEY, providerContact, rememberProviderContact } =
  await import("./provider-contact.js");
const { SETUP_KEY, answerStep, newSetup } =
  await import("./setup-assistant.js");
test.beforeEach(() => values.clear());

test("the handover contact falls back to setup answers until branding is remembered", () => {
  assert.deepEqual(providerContact(), { phone: "", area: "" });
  let state = newSetup();
  for (const [id, value] of [
    ["name", "Alex"],
    ["business", "Harbor Spatial"],
    ["contact", { email: "a@b.co", phone: "5035550100", area: "Portland, OR" }],
  ])
    state = answerStep(state, id, value);
  values.set(SETUP_KEY, JSON.stringify(state));
  assert.deepEqual(providerContact(), {
    phone: "(503) 555-0100",
    area: "Portland, OR",
  });
  assert.equal(
    rememberProviderContact({ phone: "+44 20 7946 0958", area: "" }),
    true,
  );
  assert.deepEqual(providerContact(), { phone: "+44 20 7946 0958", area: "" });
});

test("invalid or unreadable stored contacts are ignored rather than shown", () => {
  assert.equal(rememberProviderContact({ phone: "call me" }), false);
  assert.equal(values.has(PROVIDER_CONTACT_KEY), false);
  values.set(PROVIDER_CONTACT_KEY, "{broken");
  assert.deepEqual(providerContact(), { phone: "", area: "" });
  values.set(PROVIDER_CONTACT_KEY, JSON.stringify({ phone: "<script>" }));
  assert.deepEqual(providerContact(), { phone: "", area: "" });
});
