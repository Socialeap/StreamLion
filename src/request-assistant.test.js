import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTPUTS,
  REQUEST_PREFIX,
  assistantSupported,
  clearRequest,
  localDate,
  newRequest,
  readRequest,
  requestBody,
  requestFields,
  requestFlow,
  requestKey,
  welcomeLine,
  writeRequest,
} from "./request-assistant.js";
import { CLIENT_FIELDS } from "./client-permissions.js";
import { validateFields } from "./project-schema.js";
import {
  TM_CAPTURE_PRESET,
  INTAKE_PRESETS,
  validateIntakeAnswers,
} from "./intake-templates.js";
import {
  blankPricing,
  pricingRequest,
  validatePricing,
} from "./provider-pricing.js";

const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDate(date);
};
const config = validatePricing({
  ...blankPricing(),
  method: "area",
  rate: "0.15",
  allowBudget: true,
  extras: [
    {
      id: "creative-direction",
      name: "Creative Direction",
      unit: "hour",
      price: "150",
      required: false,
      maxQuantity: "100",
      defaultQuantity: "6",
    },
  ],
});
const descriptor = (extra = {}) => ({
  brand: "Harbor",
  branding: { name: "Harbor Spatial", website: "", logo: "", shape: "rounded" },
  reusable: true,
  verificationRequired: false,
  visit: "sealed-visit",
  pricing: { key: "default:1", name: "Capture", version: 1, config },
  intake: {
    id: "intake-3d",
    version: 2,
    name: "3D capture",
    description: "",
    questions: INTAKE_PRESETS[0].questions,
  },
  ...extra,
});
function run(d, answers) {
  const flow = requestFlow(d);
  let state = newRequest();
  for (const [id, value] of answers)
    state = flow.answerStep(state, id, value, {});
  return { flow, state, walked: flow.walk(state, {}) };
}
const everything = [
  ["name", "Jordan"],
  ["spaceType", "venue"],
  ["title", "The Harbor Ballroom"],
  [
    "address",
    {
      address: "1 Pier Way",
      address2: "Level 2",
      city: "Portland",
      region: "OR",
      postal: "97201",
      country: "USA",
    },
  ],
  ["size", "12,000"],
  ["floors", "2"],
  ["ceilings", "yes"],
  ["scope", "Ballroom, lobby and terrace\nfor our venue website"],
  ["deliverables", ["tour", "floorplan"]],
  ["dimensions", "Stage and loading dock"],
  ["q:deliveryDestination", "Transfer to our Matterport account"],
  ["q:document1Url", "https://plans.example/floor.pdf"],
  ["extra:creative-direction", "6"],
  ["estimate", true],
  ["budget", "$2,000"],
  ["access", "desk"],
  ["accessDetail", "Sign in at security"],
  ["siteContact", "other"],
  ["sitePerson", { name: "Sam Lee", phone: "5035550111" }],
  [
    "times",
    {
      slots: [
        { date: day(9), window: "afternoon" },
        { date: day(7), window: "morning" },
      ],
      flexible: true,
    },
  ],
  ["deadline", "date"],
  ["deadlineDate", day(30)],
  [
    "contact",
    {
      name: "Jordan Rivera",
      company: "Harbor Events",
      phone: "5035550100",
      email: "jordan@example.com",
    },
  ],
  ["role", "events"],
  ["notes", "Please avoid the Friday wedding setup."],
];

test("the flow is built from the provider's template, pricing and email rules", () => {
  const { stages, steps } = requestFlow(descriptor());
  assert.deepEqual(stages, [
    "Welcome",
    "Your space",
    "What you need",
    "Estimate",
    "Access & timing",
    "Contact",
    "Review & send",
  ]);
  const ids = steps.map((step) => step.id);
  // Template questions on core fields reword those steps; others get their own.
  assert(ids.includes("q:deliveryDestination"));
  assert(ids.includes("q:document1Url"));
  assert(!ids.includes("q:scope") && !ids.includes("q:propertySizeSqFt"));
  assert(ids.includes("extra:creative-direction"));
  const scope = steps.find((step) => step.id === "scope");
  assert.equal(scope.prompt({}).text, "Which areas need a 3D capture?");
  // Quote-only pricing has no estimate stage; without pricing there's none.
  const quote = requestFlow(descriptor({ pricing: null }));
  assert(!quote.stages.includes("Estimate"));
  assert(!quote.steps.some((step) => step.id.startsWith("extra:")));
  const name = steps[0].prompt({});
  assert.match(name.lead, /Harbor Spatial’s request assistant/);
  assert.equal(name.text, "First, what’s your first name?");
});

test("every answer maps to a client-editable field, and labelled facts go to the notes", () => {
  const d = descriptor();
  const { walked } = run(d, everything);
  assert.equal(walked.current.id, "review");
  const fields = requestFields(d, walked.answers);
  for (const key of Object.keys(fields)) assert(CLIENT_FIELDS.has(key), key);
  // The server's own field and template checks accept the result.
  validateFields(fields, { requireTitle: false });
  validateIntakeAnswers({ intake: d.intake }, fields);
  assert.deepEqual(fields, {
    title: "The Harbor Ballroom",
    address: "1 Pier Way",
    address2: "Level 2",
    city: "Portland",
    region: "OR",
    postal: "97201",
    country: "USA",
    propertySizeSqFt: "12000",
    scope: "Ballroom, lobby and terrace\nfor our venue website",
    deliverables: "3D virtual tour\nFloor plan",
    accessInstructions:
      "Front desk, concierge or security\nSign in at security",
    requesterName: "Jordan Rivera",
    companyName: "Harbor Events",
    contact1Name: "Sam Lee",
    contact1Phone: "(503) 555-0111",
    contact2Name: "Jordan Rivera",
    contact2Phone: "(503) 555-0100",
    proposedTimes: fields.proposedTimes,
    deliveryDeadline: fields.deliveryDeadline,
    deliveryDestination: "Transfer to our Matterport account",
    document1Url: "https://plans.example/floor.pdf",
    notes: [
      "Please avoid the Friday wedding setup.",
      "Space type: Event venue",
      "Floors or levels: 2",
      "Ceilings over about 12 ft: Yes",
      "Exact dimensions needed for: Stage and loading dock",
      "Requester role: Event planner",
    ].join("\n"),
  });
  const times = fields.proposedTimes.split("\n");
  assert.equal(times.length, 4);
  assert.match(times[0], /· Morning \(8 am–12 pm\)$/);
  assert.match(times[1], /· Afternoon \(12–5 pm\)$/);
  assert.equal(times[2], "Other times may work too");
  assert.equal(times[3], "Times are local to the property.");
  assert.match(fields.deliveryDeadline, /^By \w{3}, \w{3} \d{1,2}, \d{4}$/);

  // The body passes the server's own pricing check and matches its estimate.
  const body = requestBody(d, walked.answers, "token");
  assert.equal(body.email, "jordan@example.com");
  assert.equal(body.pricingKey, "default:1");
  assert.deepEqual(body.quantities, { "creative-direction": "6" });
  assert.equal(body.budget, "2000");
  const priced = pricingRequest(d, body);
  assert.equal(priced.budgetCents, 200000);
  assert.equal(priced.estimate.totalCents, 180000 + 90000);
});

test("answers that no longer apply are left out of the request", () => {
  const d = descriptor();
  const { flow, state } = run(d, everything);
  // Changing to "Me" drops the separate on-site person; a home has no ceiling question.
  let next = flow.editStep(state, "siteContact");
  next = flow.answerStep(next, "siteContact", "me", {});
  next = flow.editStep(next, "spaceType");
  next = flow.answerStep(next, "spaceType", "residential", {});
  const fields = requestFields(d, flow.walk(next, {}).answers);
  assert.equal(fields.contact1Name, "Jordan Rivera");
  assert.equal(fields.contact1Phone, "(503) 555-0100");
  assert.equal(fields.contact2Name, undefined);
  assert.doesNotMatch(fields.notes, /Ceilings/);
  // Deliverables without plans or measurements skip the dimensions question.
  next = flow.editStep(next, "deliverables");
  next = flow.answerStep(next, "deliverables", ["photos"], {});
  assert.equal(flow.walk(next, {}).current.id, "review");
  assert.doesNotMatch(
    requestFields(d, flow.walk(next, {}).answers).notes,
    /dimensions/,
  );
});

test("template conditions, choices and required questions are honoured", () => {
  const d = descriptor({
    intake: {
      id: "intake-custom",
      version: 1,
      name: "Custom",
      description: "",
      questions: [
        {
          field: "deliverables",
          label: "Which package?",
          help: "",
          required: true,
          options: ["Essentials", "Premium"],
        },
        {
          field: "exclusions",
          label: "Anything to keep out of view?",
          help: "",
          required: true,
        },
        {
          field: "document1Url",
          label: "Plan link",
          help: "",
          required: false,
          when: {
            field: "propertySizeSqFt",
            op: "greater_than",
            value: "10000",
          },
        },
      ],
    },
  });
  const small = run(d, [
    ...everything.slice(0, 4),
    ["size", "800"],
    ["floors", "1"],
    ["ceilings", "no"],
    ["scope", "Lobby"],
  ]);
  // A listed-answer template question becomes a choice of those answers.
  assert.equal(small.walked.current.id, "deliverables");
  assert.equal(small.walked.current.kind, "choice");
  assert.deepEqual(
    small.walked.current.options().map((o) => o.id),
    ["Essentials", "Premium"],
  );
  assert.throws(
    () => small.flow.answerStep(small.state, "deliverables", "Gold", {}),
    /Choose one of the listed answers/,
  );
  let state = small.flow.answerStep(small.state, "deliverables", "Premium", {});
  const exclusions = small.flow.walk(state, {}).current;
  assert.equal(exclusions.id, "q:exclusions");
  assert.equal(exclusions.optional, undefined);
  assert.throws(
    () => small.flow.answerStep(state, "q:exclusions", " ", {}),
    /Anything to keep out of view/,
  );
  state = small.flow.answerStep(state, "q:exclusions", "Staff office", {});
  // The plan link applies only above 10,000 sq ft.
  assert.equal(
    small.flow.walk(state, {}).current.id,
    "extra:creative-direction",
  );
  state = small.flow.editStep(state, "size");
  state = small.flow.answerStep(state, "size", "20000", {});
  assert.equal(small.flow.walk(state, {}).current.id, "q:document1Url");
  assert.throws(
    () =>
      small.flow.answerStep(state, "q:document1Url", "http://x.example", {}),
    /https/,
  );
  const fields = requestFields(d, small.flow.walk(state, {}).answers);
  assert.equal(fields.deliverables, "Premium");
  assert.equal(fields.exclusions, "Staff office");
  validateIntakeAnswers({ intake: d.intake }, fields);
});

test("answers are validated before they are kept", () => {
  const d = descriptor();
  const { flow, state } = run(d, everything.slice(0, 4));
  assert.throws(
    () => flow.answerStep(state, "size", "12.5", {}),
    /whole number/,
  );
  const unknown = flow.answerStep(state, "size", "", {});
  assert.equal(unknown.answers.size, "");
  // Without a size there is no estimate step, and the price is to be quoted.
  let next = unknown;
  // The plan-link question applies only to large sites, so it is skipped.
  for (const [id, value] of everything
    .slice(5, 13)
    .filter(([id]) => id !== "q:document1Url"))
    next = flow.answerStep(next, id, value, {});
  assert.equal(flow.walk(next, {}).current.id, "budget");
  assert.throws(() => flow.answerStep(next, "budget", "0", {}), /above zero/);
  const extra = flow.stepById("extra:creative-direction");
  assert.throws(() => extra.validate("101"), /at most 100 hour/);
  assert.equal(extra.validate("0"), "0");
  const times = flow.stepById("times");
  assert.throws(
    () => times.validate({ slots: [], flexible: false }, {}, {}),
    /at least one date/,
  );
  assert.throws(
    () =>
      times.validate(
        { slots: [{ date: day(-1), window: "any" }], flexible: false },
        {},
        {},
      ),
    /from today/,
  );
  assert.throws(
    () =>
      times.validate(
        {
          slots: [1, 2, 3, 4].map((n) => ({ date: day(n), window: "any" })),
          flexible: false,
        },
        {},
        {},
      ),
    /up to three/,
  );
  assert.deepEqual(times.validate({ slots: [], flexible: true }, {}, {}), {
    slots: [],
    flexible: true,
  });
  const contact = flow.stepById("contact");
  // Email is optional on a public form without confirmation…
  assert.equal(
    contact.validate({ name: "Jordan", company: "", phone: "", email: "" })
      .email,
    "",
  );
  // …and required where the provider asks for confirmation, or on an invitation.
  for (const strict of [
    descriptor({ verificationRequired: true }),
    descriptor({ reusable: false }),
  ])
    assert.throws(
      () =>
        requestFlow(strict)
          .stepById("contact")
          .validate({ name: "Jordan", company: "", phone: "", email: "" }),
      (error) => Boolean(error.fields?.email),
    );
  assert.throws(
    () => contact.validate({ name: "", company: "", phone: "12", email: "x" }),
    (error) =>
      Boolean(error.fields.name && error.fields.phone && error.fields.email),
  );
});

test("a provider's own welcome line replaces the standard greeting", () => {
  assert.equal(
    welcomeLine(
      descriptor({
        branding: { name: "Harbor Spatial", welcome: "Welcome aboard!" },
      }),
    ),
    "Welcome aboard!",
  );
  assert.match(welcomeLine({ brand: "Lumen" }), /^Hi there! I’m Lumen’s/);
});

test("forms published before provider pricing keep the one-page form", () => {
  assert.equal(
    assistantSupported({ brand: "Legacy", intake: TM_CAPTURE_PRESET }),
    false,
  );
  assert.equal(assistantSupported({ brand: "Quote", intake: null }), true);
  assert.equal(assistantSupported(descriptor({ pricing: null })), true);
  assert.equal(OUTPUTS.length, 6);
});

function memoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}
test("drafts are kept for seven days per form, keyed without the token", () => {
  const storage = memoryStorage();
  const token = "P".repeat(43);
  const now = Date.UTC(2026, 9, 17);
  const state = {
    ...newRequest(now),
    answers: { name: "Jordan" },
    done: ["name"],
  };
  assert.equal(writeRequest(token, state, storage, now), true);
  const [key] = storage.values.keys();
  assert(key.startsWith(REQUEST_PREFIX));
  assert(!key.includes(token));
  assert.equal(key, requestKey(token));
  assert.notEqual(requestKey("Q".repeat(43)), key);
  assert.deepEqual(readRequest(token, storage, now + 86400000).answers, {
    name: "Jordan",
  });
  // Another form's expired draft is removed when any draft is read.
  storage.setItem(
    requestKey("old"),
    JSON.stringify({ ...newRequest(now - 8 * 86400000) }),
  );
  storage.setItem(REQUEST_PREFIX + "broken", "{");
  readRequest(token, storage, now);
  assert.equal(storage.values.size, 1);
  assert.equal(readRequest(token, storage, now + 7 * 86400000 + 1), null);
  assert.equal(storage.values.size, 0);
  writeRequest(token, state, storage, now);
  clearRequest(token, storage);
  assert.equal(storage.values.size, 0);
  const blocked = {
    ...memoryStorage(),
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.equal(writeRequest(token, state, blocked, now), false);
});
