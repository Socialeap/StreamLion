import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example/api/client-portal",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const copied = [];
Object.defineProperty(dom.window.navigator, "clipboard", {
  value: { writeText: async (text) => copied.push(text) },
  configurable: true,
});
const { render, fireEvent, cleanup, waitFor, within } =
  await import("@testing-library/react");
const { default: RequestAssistant } = await import("./RequestAssistant.jsx");
const { INTAKE_PRESETS } = await import("./intake-templates.js");
const { blankPricing, validatePricing } = await import("./provider-pricing.js");
const { localDate, newRequest, requestFlow, writeRequest, readRequest } =
  await import("./request-assistant.js");

test.afterEach(() => cleanup());
test.after(() => dom.window.close());

const TOKEN = "P".repeat(43);
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDate(date);
};
const config = (rate = "0.15") =>
  validatePricing({
    ...blankPricing(),
    method: "area",
    rate,
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
  pricing: { key: "default:1", name: "Capture", version: 1, config: config() },
  intake: {
    id: "intake-3d",
    version: 1,
    name: "3D capture",
    description: "",
    questions: INTAKE_PRESETS[0].questions,
  },
  ...extra,
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
  };
}
const toReview = [
  ["name", "Jordan"],
  ["spaceType", "venue"],
  ["title", ""],
  [
    "address",
    {
      address: "1 Pier Way",
      address2: "",
      city: "Portland",
      region: "OR",
      postal: "",
      country: "",
    },
  ],
  ["size", "5000"],
  ["floors", "1"],
  ["ceilings", "no"],
  ["scope", "Ballroom and lobby"],
  ["deliverables", ["tour"]],
  ["q:deliveryDestination", "Our Matterport account"],
  ["extra:creative-direction", "0"],
  ["estimate", true],
  ["budget", ""],
  ["access", "meet"],
  ["accessDetail", ""],
  ["siteContact", "me"],
  ["times", { slots: [], flexible: true }],
  ["deadline", "none"],
  [
    "contact",
    { name: "Jordan Rivera", company: "", phone: "", email: "j@example.com" },
  ],
  ["role", "skip"],
  ["notes", ""],
];
function seed(d, storage, answers = toReview) {
  const flow = requestFlow(d);
  let state = newRequest();
  for (const [id, value] of answers)
    state = flow.answerStep(state, id, value, {});
  writeRequest(TOKEN, state, storage);
  return state;
}
async function choose(ui, name) {
  const button = await ui.findByRole("button", { name });
  await waitFor(() => assert.equal(button.disabled, false));
  fireEvent.click(button);
}
async function type(ui, label, value) {
  const input = await ui.findByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form"));
}

test("a client completes the provider's form one question at a time and keeps a private status link", async () => {
  const storage = memoryStorage();
  const calls = [];
  const api = async (path, body) => {
    calls.push({ path, body });
    assert.equal(path, "public/submit");
    return {
      jobId: "job-1",
      url:
        "https://app.example/api/client-portal?job=job-1#access=" +
        body.accessToken,
      expiresAt: Date.UTC(2026, 10, 16),
      message: "Request submitted.",
    };
  };
  const props = { descriptor: descriptor(), token: TOKEN, api, storage };
  const ui = render(<RequestAssistant {...props} />);
  assert(ui.getByRole("heading", { name: "Harbor Spatial" }));
  assert(ui.getByText(/Harbor Spatial’s request assistant/));
  assert(ui.getByText(/nothing is booked or charged here/));
  await type(ui, "Your first name", "Jordan");
  await ui.findByText(/Nice to meet you, Jordan!/);
  await choose(ui, /^Event venue/);
  await choose(ui, "Skip — it can wait");
  fireEvent.change(await ui.findByLabelText("Street address"), {
    target: { value: "1 Pier Way" },
  });
  fireEvent.change(ui.getByLabelText(/^City/), {
    target: { value: "Portland" },
  });
  await choose(ui, "Continue");
  // The template's own wording is used for the size question.
  await ui.findByText("Approximate area to capture (sq ft)");
  fireEvent.change(ui.getByLabelText("Approximate size in square feet"), {
    target: { value: "5000" },
  });
  await choose(ui, "Continue");
  await choose(ui, /^2$/);
  await choose(ui, /^No$/);
  await ui.findByText("Which areas need a 3D capture?");
  await type(ui, "What to capture", "Ballroom, lobby and terrace");
  await choose(ui, /^3D virtual tour/);
  await choose(ui, /^Floor plan/);
  await choose(ui, "Confirm selection");
  await choose(ui, "No specific rooms");
  await ui.findByText("Hosting and account handoff", { selector: "p" });
  // A required template question offers no skip.
  assert.equal(ui.queryByRole("button", { name: "Skip" }), null);
  await type(ui, "Hosting and account handoff", "Our Matterport account");
  await ui.findByText("Would you like to add Creative Direction?");
  await choose(ui, /^Yes · 6 hours/);
  const card = await ui.findByLabelText("Preliminary estimate");
  assert(within(card).getByText("$1,650.00"));
  assert(ui.getByText(/Not a quote/));
  await choose(ui, "Continue");
  await choose(ui, "No budget in mind");
  await ui.findByText(/don’t share door or alarm codes/);
  await choose(ui, /^Front desk, concierge or security/);
  await choose(ui, "Nothing else");
  await choose(ui, /^Me$/);
  fireEvent.change(await ui.findByLabelText("Date for option 1"), {
    target: { value: day(5) },
  });
  fireEvent.click(ui.getByRole("button", { name: "Morning" }));
  await choose(ui, "Continue");
  await choose(ui, /^No fixed deadline/);
  const name = await ui.findByLabelText("Full name");
  assert.equal(name.value, "Jordan");
  assert(ui.getByText(/Email is optional/));
  fireEvent.change(name, { target: { value: "Jordan Rivera" } });
  await choose(ui, "Continue");
  await choose(ui, /^Prefer not to say/);
  await choose(ui, "Nothing else");
  await ui.findByText(/Here’s your request, Jordan/);
  const space = ui.getByRole("region", { name: "Your space" });
  assert(within(space).getByText("Event venue"));
  assert(
    ui.getByText("Estimated total $1,650.00 · not a quote", { selector: "p" }),
  );
  await choose(ui, "Send request");
  await ui.findByText("Thanks, Jordan! Your request is with Harbor Spatial.");
  const sent = calls[0].body;
  assert.equal(sent.token, TOKEN);
  assert.equal(sent.visit, "sealed-visit");
  assert(sent.operation && sent.accessToken);
  assert.equal(sent.email, "");
  assert.deepEqual(sent.quantities, { "creative-direction": "6" });
  assert.equal(sent.fields.propertySizeSqFt, "5000");
  assert.equal(sent.fields.deliverables, "3D virtual tour\nFloor plan");
  assert.equal(sent.fields.contact1Name, "Jordan Rivera");
  assert.match(sent.fields.notes, /Space type: Event venue/);
  assert.match(sent.fields.proposedTimes, /· Morning/);
  const link = ui.getByLabelText("Your private status link");
  assert.match(link.value, /#access=/);
  await choose(ui, "Copy link");
  await ui.findByText("Link copied.");
  assert.equal(copied.at(-1), link.value);
  assert(ui.getByText("What happens next"));
  // A reload shows the same receipt instead of a fresh form.
  cleanup();
  const again = render(<RequestAssistant {...props} />);
  assert.match(
    (await again.findByLabelText("Your private status link")).value,
    /#access=/,
  );
  assert.equal(calls.length, 1);
});

test("a form that needs email confirmation sends the email and can send it again for the same request", async () => {
  const storage = memoryStorage();
  const d = descriptor({ verificationRequired: true });
  seed(d, storage);
  const bodies = [];
  const ui = render(
    <RequestAssistant
      descriptor={d}
      token={TOKEN}
      storage={storage}
      api={async (path, body) => {
        bodies.push(body);
        return {
          verificationRequired: true,
          jobId: "job-2",
          message: "Check your email to confirm and submit this request.",
        };
      }}
    />,
  );
  assert(await ui.findByText(/We’ll email j@example.com a link/));
  await choose(ui, "Send & confirm my email");
  await ui.findByText("Thanks, Jordan! Please check your inbox.");
  assert(ui.getByText(/expires in 20 minutes/));
  // A reusable form's request identity is fixed once sent.
  assert.equal(
    ui.queryByRole("button", { name: "Change something first" }),
    null,
  );
  await choose(ui, "Send the email again");
  await waitFor(() => assert.equal(bodies.length, 2));
  assert.equal(bodies[1].operation, bodies[0].operation);
  assert.equal(bodies[1].accessToken, bodies[0].accessToken);
});

test("an invitation can be changed and sent again before the email is confirmed", async () => {
  const storage = memoryStorage();
  const d = descriptor({ reusable: false, visit: undefined });
  seed(d, storage);
  const calls = [];
  const ui = render(
    <RequestAssistant
      descriptor={d}
      token={TOKEN}
      storage={storage}
      api={async (path, body) => {
        calls.push({ path, body });
        return { message: "Check your email. Verify the private link." };
      }}
    />,
  );
  await choose(ui, "Send & confirm my email");
  await ui.findByText("Thanks, Jordan! Please check your inbox.");
  assert.equal(calls[0].path, "prospect/request");
  assert.equal(calls[0].body.operation, undefined);
  await choose(ui, "Change something first");
  fireEvent.click(
    (await ui.findAllByRole("button", { name: "Edit what to capture" }))[0],
  );
  await type(ui, "What to capture", "Ballroom only");
  await choose(ui, "Send & confirm my email");
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[1].body.fields.scope, "Ballroom only");
});

test("an uncertain send keeps the same request until it is retried, even after a reload", async () => {
  const storage = memoryStorage();
  const d = descriptor();
  seed(d, storage);
  const bodies = [];
  let fail = true;
  const api = async (path, body) => {
    bodies.push(body);
    if (fail)
      throw new Error("Connection unavailable. Your form remains open.");
    return { url: "https://app.example/x#access=a", message: "Sent." };
  };
  const props = { descriptor: d, token: TOKEN, storage, api };
  const ui = render(<RequestAssistant {...props} />);
  await choose(ui, "Send request");
  await ui.findByText("Connection unavailable. Your form remains open.");
  cleanup();
  const again = render(<RequestAssistant {...props} />);
  await again.findByText(/may already have reached Harbor Spatial/);
  for (const button of again.getAllByRole("button", { name: /^Edit / }))
    assert.equal(button.disabled, true);
  assert.equal(again.queryByRole("button", { name: "One-page form" }), null);
  fail = false;
  await choose(again, "Retry sending");
  await again.findByText(
    "Thanks, Jordan! Your request is with Harbor Spatial.",
  );
  assert.equal(bodies[1].operation, bodies[0].operation);
  assert.equal(readRequest(TOKEN, storage).status, "complete");
});

test("changed prices are reloaded, shown again and sent as a new request", async () => {
  const storage = memoryStorage();
  const d = descriptor();
  seed(d, storage);
  const bodies = [];
  const api = async (path, body) => {
    if (path === "public/open")
      return descriptor({
        pricing: {
          key: "default:2",
          name: "Capture",
          version: 2,
          config: config("0.20"),
        },
      });
    bodies.push(body);
    if (bodies.length === 1)
      throw Object.assign(new Error("Pricing changed."), {
        status: 409,
        code: "pricing_changed",
      });
    return { url: "https://app.example/x#access=a", message: "Sent." };
  };
  const ui = render(
    <RequestAssistant
      descriptor={d}
      token={TOKEN}
      storage={storage}
      api={api}
    />,
  );
  await choose(ui, "Send request");
  await ui.findByText(/changed their prices/);
  await choose(ui, "Review updated prices");
  const card = await ui.findByLabelText("Preliminary estimate");
  assert.match(card.textContent, /Preliminary estimate\$1,000\.00/);
  assert(ui.getByText(/Prices updated/));
  await choose(ui, "Continue");
  await choose(ui, "Send request");
  await ui.findByText(/Your request is with Harbor Spatial/);
  assert.equal(bodies[1].pricingKey, "default:2");
  assert.notEqual(bodies[1].operation, bodies[0].operation);
});

test("the provider's welcome line and logo greet the client, and the one-page form is offered", async () => {
  const storage = memoryStorage();
  const seeds = [];
  const logo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const ui = render(
    <RequestAssistant
      descriptor={descriptor({
        branding: {
          name: "Harbor Spatial",
          welcome: "Welcome to Harbor! Let’s plan your capture.",
          logo,
          shape: "rounded",
        },
      })}
      token={TOKEN}
      storage={storage}
      api={async () => ({})}
      onShowForm={(seed) => seeds.push(seed)}
    />,
  );
  assert(ui.getByText("Welcome to Harbor! Let’s plan your capture."));
  assert.equal(ui.queryByText(/request assistant, and I’ll help/), null);
  assert(document.querySelector(".setup-avatar-logo"));
  await type(ui, "Your first name", "Jordan");
  await choose(ui, /^Office or commercial/);
  await choose(ui, "One-page form");
  assert.deepEqual(seeds[0].fields, {
    notes: "Space type: Office or commercial",
  });
});

test("shared form links open the assistant, and the one-page form keeps the answers", async () => {
  const { default: Portal } = await import("./CoordinationPortal.jsx");
  window.history.replaceState(null, "", "/api/client-portal#form=" + TOKEN);
  localStorage.clear();
  const ui = render(
    <Portal
      client
      api={async (path) => {
        if (path === "public/open") return descriptor();
        throw new Error("Unexpected " + path);
      }}
    />,
  );
  await type(ui, "Your first name", "Jordan");
  await choose(ui, /^Event venue/);
  await choose(ui, "One-page form");
  await ui.findByRole("heading", { name: "Estimate & work-order request" });
  assert.match(
    ui.getByRole("textbox", { name: /Additional notes/ }).value,
    /Space type: Event venue/,
  );
  await choose(ui, "Answer one question at a time instead");
  await ui.findByText(/Nice to meet you, Jordan!/);
  window.history.replaceState(null, "", "/api/client-portal");
});
