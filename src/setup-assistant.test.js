import test from "node:test";
import assert from "node:assert/strict";
import {
  SETUP_KEY,
  TIER_DEFAULTS,
  answerStep,
  brandingSuggestion,
  currencyForLocale,
  deliverableOptions,
  editStep,
  newSetup,
  pricingConfig,
  providerDefaults,
  readSetup,
  reopenSetup,
  setupProfile,
  stageProgress,
  walk,
  writeSetup,
} from "./setup-assistant.js";
import { validatePricing } from "./provider-pricing.js";

const online = { online: true, googleAvailable: true };
function run(answers, ctx = online, state = newSetup("2026-10-16T00:00:00Z")) {
  for (const [id, value] of answers) {
    const current = walk(state, ctx).current?.id;
    assert.equal(current, id, `expected ${id} next, got ${current}`);
    state = answerStep(state, id, value, ctx, "2026-10-16T00:00:01Z");
  }
  return state;
}
const identity = [
  ["name", "Alex"],
  ["business", "Harbor Spatial"],
  [
    "contact",
    { email: "alex@harbor.example", phone: "", area: "", website: "" },
  ],
];
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test("a device-first provider is asked only what their answers make relevant", () => {
  const state = run([
    ...identity,
    ["focus", ["briefs"]],
    ["hardware", ["leica-blk360"]],
    ["deliverables", ["e57", "pointcloud"]],
    ["storage", "device"],
    ["aiUses", []],
    ["theme", "dark"],
    ["review", true],
  ]);
  assert.equal(state.status, "complete");
  assert.equal(walk(state, online).current, null);
  const asked = walk(state, online).history.map(({ step }) => step.id);
  // No 360 hosting, units, pricing, logo or Google steps for this profile.
  for (const id of [
    "tourHosting",
    "units",
    "pricingMethod",
    "logo",
    "google",
    "workbook",
    "siteCopy",
  ])
    assert(!asked.includes(id), id);
  const profile = setupProfile(state);
  assert.deepEqual(profile.deliverables, [
    "E57 point cloud",
    "Registered point cloud (LAS / RCP)",
  ]);
  assert.equal(profile.pricing, null);
  assert.equal(profile.storage, "device");
  assert.equal(profile.complete, true);
});

test("hardware drives deliverable options, 360 hosting and the custom system question", () => {
  const options = (hardware) =>
    deliverableOptions({ hardware }).map((item) => item.id);
  assert(options(["matterport-pro3"]).includes("space"));
  assert(options(["matterport-pro2"]).includes("transfer"));
  assert(!options(["insta360", "leica-blk360"]).includes("transfer"));
  assert(!options(["drone"]).includes("space"));
  assert(options(["drone"]).includes("orthomosaic"));
  const state = run([
    ...identity,
    ["focus", ["handover"]],
    ["hardware", ["matterport-pro2", "insta360", "other"]],
    ["hardwareOther", "NavVis VLX"],
    ["deliverables", ["space", "transfer", "tour"]],
    ["tourHosting", ["kuula", "cloudpano"]],
    ["storage", "device"],
  ]);
  const profile = setupProfile(state);
  assert.deepEqual(profile.hardware, [
    "Matterport Pro2",
    "Insta360 (X3 / X4 / 1-inch 360)",
    "NavVis VLX",
  ]);
  assert.deepEqual(profile.deliverables, [
    "Matterport Space link",
    "Matterport Model Transfer",
    "360° virtual tour link (Kuula, CloudPano)",
  ]);
  assert.throws(
    () =>
      answerStep(
        run([...identity, ["focus", ["handover"]], ["hardware", ["drone"]]]),
        "deliverables",
        ["space"],
        online,
      ),
    /listed deliverables/,
  );
});

test("contact details are validated and gently normalized", () => {
  const state = run(identity.slice(0, 2));
  try {
    answerStep(state, "contact", { email: "alex@", phone: "12" }, online);
    assert.fail("expected validation error");
  } catch (error) {
    assert.match(error.fields.email, /valid email/);
    assert.match(error.fields.phone, /7 to 15 digits/);
  }
  const next = answerStep(
    state,
    "contact",
    {
      email: " alex@harbor.example ",
      phone: "503 555 0100",
      area: "  Portland,   OR ",
      website: "harbor.example",
    },
    online,
  );
  assert.deepEqual(next.answers.contact, {
    email: "alex@harbor.example",
    phone: "(503) 555-0100",
    area: "Portland, OR",
    website: "https://harbor.example/",
  });
  const international = answerStep(
    state,
    "contact",
    { email: "a@b.co", phone: "+44 20 7946 0958" },
    online,
  );
  assert.equal(international.answers.contact.phone, "+44 20 7946 0958");
  assert.throws(
    () =>
      answerStep(
        state,
        "contact",
        { email: "a@b.co", website: "http://insecure.example" },
        online,
      ),
    /HTTPS/,
  );
  assert.throws(
    () => answerStep(run(identity.slice(0, 1)), "business", "x".repeat(101)),
    /up to 100/,
  );
});

test("every pricing path produces a configuration the existing pricing contract accepts", () => {
  const base = [...identity, ["focus", ["requests"]], ["hardware", ["dslr"]]];
  const lead = [...base, ["deliverables", []], ["storage", "device"]];
  const area = run([
    ...lead,
    ["pricingMethod", "area"],
    ["currency", "gbp"],
    ["rate", ".2"],
    ["budget", "no"],
  ]);
  assert.deepEqual(pricingConfig(area.answers), {
    ...validatePricing(pricingConfig(area.answers)),
    method: "area",
    currency: "GBP",
    rate: "0.2",
  });
  const whole = run([
    ...lead,
    ["pricingMethod", "tiers"],
    ["tierStyle", "whole"],
    ["currency", "USD"],
    ["tiers", TIER_DEFAULTS.tiers],
    ["budget", "yes"],
  ]);
  assert.equal(pricingConfig(whole.answers).method, "whole");
  assert.equal(pricingConfig(whole.answers).allowBudget, true);
  const flat = run([
    ...lead,
    ["pricingMethod", "flat"],
    ["currency", "USD"],
    [
      "tiers",
      [
        { upTo: "4000", price: "300" },
        { upTo: "", price: "650" },
      ],
    ],
    ["budget", "no"],
  ]);
  assert.equal(pricingConfig(flat.answers).method, "flat");
  assert.equal(pricingConfig(flat.answers).tiers.length, 2);
  const quote = run([
    ...lead,
    ["pricingMethod", "quote"],
    ["currency", "CAD"],
    ["budget", "yes"],
  ]);
  assert.equal(pricingConfig(quote.answers).method, "quote");
  assert.equal(
    pricingConfig(run([...lead, ["pricingMethod", "skip"]]).answers),
    null,
  );
  const perClient = run([
    ...lead,
    ["pricingMethod", "area"],
    ["currency", "USD"],
    ["rate", "0.15"],
    ["budget", "per-client"],
  ]);
  assert.equal(pricingConfig(perClient.answers).allowBudget, false);
  assert.equal(pricingConfig(perClient.answers).budgetPerClient, true);
  assert.equal(
    walk(perClient, online).history.at(-1).step.summary("per-client"),
    "Set per client",
  );
  const rateStep = run([
    ...lead,
    ["pricingMethod", "area"],
    ["currency", "USD"],
  ]);
  assert.throws(() => answerStep(rateStep, "rate", "0", online), /above zero/);
  assert.throws(
    () => answerStep(rateStep, "rate", "1.23456", online),
    /4 decimal places/,
  );
  const tierStep = run([
    ...lead,
    ["pricingMethod", "flat"],
    ["currency", "USD"],
  ]);
  assert.throws(
    () =>
      answerStep(
        tierStep,
        "tiers",
        [
          { upTo: "5000", price: "300" },
          { upTo: "4000", price: "500" },
          { upTo: "", price: "700" },
        ],
        online,
      ),
    /increase/,
  );
  const currencyStep = run([...lead, ["pricingMethod", "flat"]]);
  assert.throws(
    () => answerStep(currencyStep, "currency", "JPY", online),
    /two decimal places/,
  );
});

test("Google steps follow the live connection, and a workbook counts only once it is loaded", () => {
  const lead = [
    ...identity,
    ["focus", ["field"]],
    ["hardware", ["lidar"]],
    ["deliverables", ["floorplan"]],
  ];
  let state = run([...lead, ["storage", "google"]]);
  assert.equal(walk(state, online).current.id, "google");
  // Returning from Google's page: connected but the workbook is not chosen.
  const connected = {
    ...online,
    connected: true,
    account: "alex@harbor.example",
  };
  assert.equal(walk(state, connected).current.id, "workbook");
  state = answerStep(
    state,
    "workbook",
    { bookId: "book-1", how: "created" },
    connected,
  );
  // Still not loaded: the workbook step is asked again rather than trusted.
  assert.equal(walk(state, connected).current.id, "workbook");
  const ready = { ...connected, workbookReady: true, bookId: "book-1" };
  const walked = walk(state, ready);
  assert.equal(walked.current.id, "siteCopy");
  assert.equal(walked.answers.workbook.how, "created");
  // An account whose saved workbook restores is never asked to create another.
  const restored = walk(run([...lead, ["storage", "google"]]), {
    ...ready,
    bookId: "saved-book",
  });
  assert.deepEqual(restored.answers.workbook, {
    bookId: "saved-book",
    how: "existing",
  });
  // An existing site copy needs no question.
  assert.equal(walk(state, { ...ready, siteCopy: true }).current.id, "units");
});

test("offline providers cannot choose Google now, but stored answers survive going offline", () => {
  const lead = [
    ...identity,
    ["focus", ["briefs"]],
    ["hardware", ["drone"]],
    ["deliverables", []],
  ];
  const offline = { online: false, googleAvailable: true };
  const pending = run(lead, offline);
  assert.throws(
    () => answerStep(pending, "storage", "google", offline),
    /offline/,
  );
  const device = answerStep(pending, "storage", "device", offline);
  assert.equal(walk(device, offline).current.id, "aiUses");
  const unavailable = { online: true, googleAvailable: false };
  assert.throws(
    () => answerStep(pending, "storage", "google", unavailable),
    /isn’t available/,
  );
  const google = run([...lead, ["storage", "google"]]);
  assert.equal(walk(google, offline).current.id, "google");
  assert.equal(walk(google, offline).answers.storage, "google");
});

test("editing re-asks only that answer, while dependent answers are asked again", () => {
  const complete = run([
    ...identity,
    ["focus", ["requests", "field"]],
    ["hardware", ["matterport-pro3"]],
    ["deliverables", ["space"]],
    ["storage", "device"],
    ["units", "imperial"],
    ["pricingMethod", "area"],
    ["currency", "USD"],
    ["rate", "0.15"],
    ["budget", "no"],
    ["aiUses", []],
    ["logo", null],
    ["welcome", ""],
    ["theme", "light"],
    ["review", true],
  ]);
  let state = editStep(complete, "name");
  assert.equal(state.status, "active");
  assert.equal(walk(state, online).current.id, "name");
  state = answerStep(state, "name", "Sam", online);
  // Everything else is kept; only the final review is reconfirmed.
  assert.equal(walk(state, online).current.id, "review");
  assert.equal(
    walk(state, online)
      .current.prompt(walk(state, online).answers)
      .text.includes("Sam"),
    true,
  );
  state = editStep(state, "pricingMethod");
  state = answerStep(state, "pricingMethod", "flat", online);
  assert.equal(walk(state, online).current.id, "currency");
  assert.equal(
    state.answers.currency,
    "USD",
    "previous answer stays as the default",
  );
  state = editStep(complete, "focus");
  state = answerStep(state, "focus", ["field"], online);
  const walked = walk(state, online);
  assert.equal(walked.current.id, "review");
  assert.equal(setupProfile(state).pricing, null, "pricing no longer applies");
  assert.equal(setupProfile(state).logo, null);
  assert.equal(
    walk(reopenSetup(complete), online).current.id,
    "review",
    "a finished setup reopens on its review",
  );
});

test("answers persist on the device and invalid saved state is ignored", () => {
  const storage = memoryStorage();
  assert.equal(readSetup(storage), null);
  const state = run(identity.slice(0, 1));
  assert.equal(writeSetup(state, storage), true);
  assert.deepEqual(readSetup(storage), state);
  storage.setItem(SETUP_KEY, "{not json");
  assert.equal(readSetup(storage), null);
  storage.setItem(SETUP_KEY, JSON.stringify({ ...state, done: ["unknown"] }));
  assert.equal(readSetup(storage), null);
  const blocked = {
    getItem: () => null,
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(writeSetup(state, blocked), false);
});

test("client-request providers can write the request assistant's welcome line", () => {
  const lead = [
    ...identity,
    ["focus", ["requests"]],
    ["hardware", ["dslr"]],
    ["deliverables", []],
    ["storage", "device"],
    ["pricingMethod", "skip"],
    ["aiUses", []],
    ["logo", null],
  ];
  const state = run(lead);
  const step = walk(state, online).current;
  assert.equal(step.id, "welcome");
  assert.match(step.prompt(walk(state, online).answers).hint, /Harbor Spatial/);
  assert.throws(
    () => answerStep(state, "welcome", "x".repeat(281), online),
    /under 280 characters/,
  );
  const written = answerStep(
    state,
    "welcome",
    "  Welcome to Harbor!\n Let’s plan your capture. ",
    online,
  );
  assert.equal(
    written.answers.welcome,
    "Welcome to Harbor! Let’s plan your capture.",
  );
  assert.equal(
    brandingSuggestion(setupProfile(written)).welcome,
    "Welcome to Harbor! Let’s plan your capture.",
  );
  // The standard greeting is an empty welcome; other providers are not asked.
  assert.equal(
    setupProfile(answerStep(state, "welcome", "", online)).welcome,
    "",
  );
  const briefsOnly = run([...identity, ["focus", ["briefs"]]]);
  assert.equal(setupProfile(briefsOnly).welcome, "");
});

test("progress, locale currency and profile defaults stay small and predictable", () => {
  const state = run(identity);
  assert.deepEqual(stageProgress(walk(state, online)), {
    stage: 2,
    label: "Your work",
    percent: 29,
  });
  assert.equal(currencyForLocale("en-CA"), "CAD");
  assert.equal(currencyForLocale("de-DE"), "EUR");
  assert.equal(currencyForLocale("ja-JP"), "USD");
  assert.equal(currencyForLocale(undefined), "USD");
  const profile = setupProfile(state);
  assert.deepEqual(providerDefaults(profile), {
    providerName: "Harbor Spatial",
    providerEmail: "alex@harbor.example",
  });
  assert.deepEqual(brandingSuggestion(profile), {
    name: "Harbor Spatial",
    website: "",
    phone: "",
    area: "",
    welcome: "",
    logo: "",
    shape: "rounded",
  });
  assert.deepEqual(providerDefaults(null), {});
  assert.equal(brandingSuggestion(null), null);
});

test("AI questions branch: credits only for built-in AI, read-aloud only for project questions", () => {
  const lead = [
    ...identity,
    ["focus", ["briefs"]],
    ["hardware", ["dslr"]],
    ["deliverables", []],
    ["storage", "device"],
  ];
  const manualOnly = run([...lead, ["aiUses", []]]);
  assert.equal(walk(manualOnly, online).current.id, "theme");
  assert.deepEqual(setupProfile(manualOnly).ai, {
    uses: [],
    readAloud: null,
    credits: "",
  });
  const asking = run([
    ...lead,
    ["aiUses", ["ask"]],
    ["aiVoice", "aloud"],
    ["aiCredits", "later"],
  ]);
  assert.equal(walk(asking, online).current.id, "theme");
  assert.equal(setupProfile(asking).ai.readAloud, true);
  assert.equal(setupProfile(asking).ai.credits, "later");
  const briefs = run([...lead, ["aiUses", ["brief"]]]);
  assert.equal(walk(briefs, online).current.id, "aiCredits");
  assert.throws(
    () => answerStep(briefs, "aiCredits", "maybe", online),
    /Choose an option/,
  );
  // Dropping built-in AI no longer asks about credits or read-aloud.
  let edited = editStep(asking, "aiUses");
  edited = answerStep(edited, "aiUses", [], online);
  assert.equal(walk(edited, online).current.id, "theme");
  assert.equal(setupProfile(edited).ai.credits, "");
});

test("the newest answered setup wins between this device and the account", async () => {
  const { newerSetup } = await import("./setup-assistant.js");
  const { syncSetup } = await import("./setup-sync.js");
  const answered = (iso, name) =>
    answerStep(newSetup(iso), "name", name, online, iso);
  const old = answered("2026-10-18T09:00:00.000Z", "Old");
  const recent = answered("2026-10-18T10:00:00.000Z", "Alex");
  assert.equal(newerSetup(old, recent), recent);
  assert.equal(newerSetup(recent, old), recent);
  // A brand-new empty setup never replaces saved answers.
  assert.equal(newerSetup(newSetup("2026-10-19T00:00:00.000Z"), old), old);
  assert.equal(newerSetup(null, old), old);
  assert.equal(newerSetup(null, null), null);

  const storage = memoryStorage();
  const pushed = [];
  let remote = recent;
  const api = async (state, subject) => {
    if (state) {
      pushed.push([state, subject]);
      remote = state;
    }
    return { available: true, subject: "s", state: remote };
  };
  // A new device receives the account's answers without writing back.
  assert.equal((await syncSetup(api, storage)).answers.name, "Alex");
  assert.equal(readSetup(storage).answers.name, "Alex");
  assert.equal(pushed.length, 0);
  // Newer answers on this device go up to the account.
  writeSetup(
    { ...answered("2026-10-18T12:00:00.000Z", "Sam"), accountSubject: "s" },
    storage,
  );
  await syncSetup(api, storage);
  assert.equal(pushed.length, 1);
  assert.equal(remote.answers.name, "Sam");
  assert.equal(
    await syncSetup(async () => ({ available: false }), storage),
    undefined,
  );
});
