import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example/",
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
const testing = await import("@testing-library/react");
const { fireEvent, cleanup, waitFor, within, act } = testing;
// Let the Google configuration load settle inside act() before interacting.
async function flush() {
  await act(async () => {});
}
async function open(element) {
  const ui = testing.render(element);
  await flush();
  return ui;
}
const { default: SetupAssistant } = await import("./SetupAssistant.jsx");
const { SETUP_KEY, readSetup, answerStep, newSetup } =
  await import("./setup-assistant.js");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const config = {
  clientId: "test.apps.googleusercontent.com",
  apiKey: "public-test",
  appId: "123",
  persistentEnabled: true,
};
let calls, online;
function fakeGoogle(overrides = {}) {
  return {
    connect: async () => calls.push(["connect"]),
    createWorkbook: async () => {
      calls.push(["create"]);
      return { spreadsheetId: "new-book" };
    },
    moveWorkbookToFolder: async (id) => calls.push(["move", id]),
    pickWorkbook: async () => "picked-book",
    readWorkbook: async (id) => {
      calls.push(["read", id]);
      return { Projects: [], Observations: [] };
    },
    hasSession: () => false,
    account: () => "",
    folderId: () => "folder-1",
    ...overrides,
  };
}
const props = (extra = {}) => ({
  loadConfig: async () => config,
  google: fakeGoogle(),
  brandingApi: async () => assert.fail("branding must not be called"),
  pricingApi: async () => assert.fail("pricing must not be called"),
  convertLogo: async () => PNG,
  onWorkbook: async (id) => calls.push(["workbook", id]),
  onSiteCopy: async () => calls.push(["siteCopy"]),
  onFinish: (to) => calls.push(["finish", to]),
  onExit: () => calls.push(["exit"]),
  setupApi: async () => ({ available: false, subject: "subject-a" }),
  ...extra,
});
test.beforeEach(() => {
  cleanup();
  localStorage.clear();
  calls = [];
  online = true;
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  delete document.documentElement.dataset.theme;
  globalThis.fetch = async (url) => {
    throw new Error("Unexpected request: " + url);
  };
});
test.after(() => {
  cleanup();
  dom.window.close();
});

async function say(ui, label, value) {
  const input = await ui.findByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form"));
}
async function choose(ui, name) {
  const button = await ui.findByRole("button", { name });
  await waitFor(() => assert.equal(button.disabled, false));
  fireEvent.click(button);
}
async function tags(ui, names) {
  for (const name of names) await choose(ui, name);
  await choose(ui, "Confirm selection");
}
async function contact(ui, email = "alex@harbor.example") {
  fireEvent.change(await ui.findByLabelText("Business email"), {
    target: { value: email },
  });
  await choose(ui, "Continue");
}
async function intro(ui) {
  await say(ui, "What should I call you?", "Alex");
  await say(ui, "Business or trade name", "Harbor Spatial");
  await contact(ui);
}

test("the chat greets, takes one answer at a time and keeps an editable transcript", async () => {
  const ui = await open(<SetupAssistant {...props()} />);
  assert(ui.getByRole("heading", { name: "Setup assistant" }));
  const log = ui.getByRole("log", { name: "Setup conversation" });
  assert.equal(log.getAttribute("aria-live"), "polite");
  assert(within(log).getByText(/What should I call you\?/));
  assert(ui.getByText("Step 1 of 7 · About you"));
  await say(ui, "What should I call you?", "Alex");
  await ui.findByText(/Nice to meet you, Alex!/);
  assert(within(log).getByText("Alex"));
  assert(ui.getByRole("button", { name: "Use “Alex”" }));
  assert.equal(readSetup().answers.name, "Alex");
  fireEvent.click(ui.getByRole("button", { name: "Edit name" }));
  const input = await ui.findByLabelText("What should I call you?");
  assert.equal(input.value, "Alex");
  assert(ui.getByText(/Editing your answer/));
  await say(ui, "What should I call you?", "Sam");
  await ui.findByText(/Nice to meet you, Sam!/);
  await say(ui, "Business or trade name", "Harbor Spatial");
  await ui.findByLabelText("Business email");
  // Escape returns to the pending question with the previous answer kept.
  fireEvent.click(ui.getByRole("button", { name: "Edit name" }));
  const editing = await ui.findByLabelText("What should I call you?");
  fireEvent.keyDown(editing, { key: "Escape" });
  await ui.findByLabelText("Business email");
  assert.equal(readSetup().answers.name, "Sam");
});

test("a reload resumes at the exact pending step with its history", async () => {
  const first = await open(<SetupAssistant {...props()} />);
  await say(first, "What should I call you?", "Alex");
  await say(first, "Business or trade name", "Harbor Spatial");
  await first.findByLabelText("Business email");
  first.unmount();
  const ui = await open(<SetupAssistant {...props()} />);
  await ui.findByLabelText("Business email");
  const log = ui.getByRole("log", { name: "Setup conversation" });
  assert(within(log).getByText("Alex"));
  assert(within(log).getByText("Harbor Spatial"));
  assert(ui.getByText("Step 2 of 7 · Contact"));
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  assert.deepEqual(calls, [["exit"]]);
  assert.equal(readSetup().status, "active");
});

test("contact details show field-level validation without leaving the form", async () => {
  const ui = await open(<SetupAssistant {...props()} />);
  await say(ui, "What should I call you?", "Alex");
  await say(ui, "Business or trade name", "Harbor Spatial");
  fireEvent.change(await ui.findByLabelText(/^Phone/), {
    target: { value: "12" },
  });
  await contact(ui, "not-an-email");
  await ui.findByText(/Enter a valid email address/);
  assert.equal(
    ui.getByLabelText("Business email").getAttribute("aria-invalid"),
    "true",
  );
  assert(ui.getByText(/7 to 15 digits/));
  fireEvent.change(ui.getByLabelText(/^Phone/), {
    target: { value: "5035550100" },
  });
  await contact(ui);
  await ui.findByText(/How do you plan to use StreamLion/);
  assert(ui.getByText("(503) 555-0100"));
});

test("a device-first setup branches by answers, applies the theme and finishes with no network writes", async () => {
  const ui = await open(<SetupAssistant {...props()} />);
  await intro(ui);
  assert.equal(
    ui.getByRole("button", { name: "Confirm selection" }).disabled,
    true,
  );
  const requests = await ui.findByRole("button", {
    name: /^Client requests/,
  });
  fireEvent.click(requests);
  assert.equal(requests.getAttribute("aria-pressed"), "true");
  await tags(ui, [/^On-site notes/]);
  await ui.findByText(/Which capture systems/);
  await tags(ui, ["Matterport Pro3", /^Insta360/]);
  await ui.findByText(/Which Matterport and other deliverables/);
  await tags(ui, ["Matterport Space link", "360° virtual tour link"]);
  await ui.findByText(/Where do you host 360° tours/);
  await choose(ui, "Not sure yet");
  await ui.findByText(/Would you like to connect Google now/);
  await choose(ui, /^Start on this device/);
  await ui.findByText(/Which measurement system/);
  await choose(ui, /^Metric/);
  await ui.findByText(/calculated from square footage/);
  await choose(ui, /^One rate per square foot/);
  await choose(ui, "USD");
  const rate = await ui.findByLabelText("Rate per square foot");
  assert.equal(rate.value, "0.15");
  fireEvent.click(ui.getByRole("button", { name: "Increase" }));
  assert.equal(rate.value, "0.16");
  await choose(ui, "Continue");
  await choose(ui, /^No$/);
  await choose(ui, "Not now");
  await ui.findByText(/add your logo/);
  await choose(ui, "Skip for now");
  await choose(ui, "Use the standard greeting");
  await choose(ui, "Dark");
  assert.equal(document.documentElement.dataset.theme, "dark");
  await ui.findByText(/Here’s your setup, Alex/);
  const review = ui.getByRole("region", { name: "Pricing & units" });
  assert(within(review).getByText("0.16 USD per sq ft"));
  assert(
    ui.getByText(/Keep your branding and pricing on this device/, {
      exact: false,
    }),
  );
  await choose(ui, "Save & finish");
  await ui.findByText(/You’re all set, Alex!/);
  assert.equal(readSetup().status, "complete");
  fireEvent.click(ui.getByRole("button", { name: "Create my first project" }));
  assert.deepEqual(calls, [["finish", "new"]]);
});

test("Google sign-in, workbook creation, offline copy and publishing happen only from explicit choices", async () => {
  const branding = [],
    pricing = [];
  const brandingApi = async (body, subject) => {
    branding.push([body, subject]);
    return body
      ? { available: true, version: 3, branding: body.branding }
      : {
          subject: "subject-a",
          account: "alex@harbor.example",
          available: true,
          version: 2,
          branding: {
            name: "Old name",
            website: "https://old.example/",
            logo: PNG,
            shape: "square",
          },
        };
  };
  const extra = {
    id: "travel",
    name: "Travel",
    unit: "trip",
    price: "50",
    required: false,
    maxQuantity: "5",
    defaultQuantity: "1",
  };
  const pricingApi = async (body, subject) => {
    pricing.push([body, subject]);
    return body
      ? { available: true, profiles: [] }
      : {
          subject: "subject-a",
          account: "alex@harbor.example",
          available: true,
          profiles: [
            {
              id: "default",
              name: "Standard",
              version: 4,
              config: { extras: [extra] },
            },
          ],
        };
  };
  const base = props({ brandingApi, pricingApi });
  const ui = await open(<SetupAssistant {...base} />);
  await intro(ui);
  await tags(ui, [/^Client requests/, /^On-site notes/]);
  await tags(ui, ["Leica BLK360"]);
  await tags(ui, ["E57 point cloud"]);
  await choose(ui, /^Connect Google/);
  const link = await ui.findByRole("link", { name: "Continue with Google" });
  assert.equal(link.getAttribute("href"), "/api/google/start");
  assert(ui.getByText(/only the files it creates or that you choose/));
  assert.deepEqual(calls, [], "nothing starts before the provider's click");
  // Google's page returns here; the parent restores the session.
  const connected = {
    ...base,
    connected: true,
    account: "alex@harbor.example",
  };
  ui.rerender(<SetupAssistant {...base} checking />);
  await ui.findByText(/Checking your Google connection/);
  ui.rerender(<SetupAssistant {...connected} />);
  await choose(ui, "Use this device’s setup for this account");
  await ui.findByText("Signed in as alex@harbor.example");
  await choose(ui, /^Create a new workbook/);
  await waitFor(() =>
    assert.deepEqual(calls, [
      ["create"],
      ["move", "new-book"],
      ["read", "new-book"],
      ["workbook", "new-book"],
    ]),
  );
  const ready = { ...connected, workbookReady: true, bookId: "new-book" };
  ui.rerender(<SetupAssistant {...ready} />);
  await ui.findByText("Created a workbook in my StreamLion folder");
  await ui.findByText(/Keep a read-only copy of your workbook/);
  await choose(ui, /^Yes, this is my own device/);
  await waitFor(() => assert.deepEqual(calls.at(-1), ["siteCopy"]));
  ui.rerender(<SetupAssistant {...ready} siteCopy />);
  await choose(ui, /^Imperial/);
  await choose(ui, /^Rates that change with property size/);
  await choose(ui, /^Price each size band separately/);
  await choose(ui, "CAD");
  await ui.findByRole("group", { name: "Number of bands" });
  fireEvent.click(ui.getByRole("button", { name: "Two bands" }));
  await choose(ui, "Continue");
  await choose(ui, /^Yes, let them propose one/);
  await choose(ui, "Not now");
  await ui.findByText(/add your logo/);
  await choose(ui, "Skip for now");
  const welcome = await ui.findByLabelText("Welcome line for clients");
  fireEvent.change(welcome, {
    target: { value: "Welcome to Harbor Spatial! Let’s plan your capture." },
  });
  fireEvent.submit(welcome.closest("form"));
  await choose(ui, "Light");
  await ui.findByText(/Save “Harbor Spatial”/);
  assert(ui.getByText(/Publish this pricing as the default/));
  assert.equal(branding.length + pricing.length, 0);
  await choose(ui, "Save & finish");
  await ui.findByText("Business branding saved to your client pages");
  assert(ui.getByText("Default pricing published for new request forms"));
  assert.equal(branding.length, 2);
  assert.deepEqual(branding[1], [
    {
      version: 2,
      branding: {
        name: "Harbor Spatial",
        website: "https://old.example/",
        logo: PNG,
        shape: "square",
        welcome: "Welcome to Harbor Spatial! Let’s plan your capture.",
      },
    },
    "subject-a",
  ]);
  const [published, subject] = pricing[1];
  assert.equal(subject, "subject-a");
  assert.equal(published.id, "default");
  assert.equal(published.name, "Standard");
  assert.equal(published.version, 4);
  assert.equal(published.config.method, "progressive");
  assert.equal(published.config.currency, "CAD");
  assert.equal(published.config.tiers.length, 2);
  assert.equal(published.config.allowBudget, true);
  assert.deepEqual(published.config.extras, [extra]);
});

test("publishing problems are reported without losing the finished setup", async () => {
  const ui = await open(
    <SetupAssistant
      {...props({
        google: fakeGoogle({ hasSession: () => true, account: () => "a@b.co" }),
        brandingApi: async () => ({ available: false, version: 0 }),
        pricingApi: async () => {
          throw new Error("Pricing is unavailable.");
        },
      })}
      connected
      account="a@b.co"
      workbookReady
      bookId="saved-book"
    />,
  );
  await intro(ui);
  await tags(ui, [/^Client requests/]);
  await tags(ui, ["DSLR / mirrorless"]);
  await choose(ui, "None of these");
  await ui.findByText(/You’re signed in to Google as a@b.co/);
  await choose(ui, /^Use my Google account/);
  await ui.findByText("Use my saved workbook");
  await choose(ui, /^I quote each job myself/);
  await choose(ui, "USD");
  await choose(ui, /^No$/);
  await choose(ui, "Not now");
  await choose(ui, "Skip for now");
  await choose(ui, "Use the standard greeting");
  await choose(ui, "Light");
  await choose(ui, "Save & finish");
  await ui.findByText(/Business branding awaits activation/);
  assert(ui.getByText(/Pricing wasn’t published: Pricing is unavailable/));
  assert.equal(readSetup().status, "complete");
});

test("offline providers keep going on this device, and Google can be swapped for device storage", async () => {
  online = false;
  const ui = await open(<SetupAssistant {...props()} />);
  await intro(ui);
  await tags(ui, [/^Project briefs/]);
  await tags(ui, ["Drone / aerial"]);
  await choose(ui, "None of these");
  await ui.findByText(/You’re offline right now/);
  assert.equal(
    ui.getByRole("button", { name: /^Connect Google/ }).disabled,
    true,
  );
  online = true;
  fireEvent(window, new window.Event("online"));
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: /^Connect Google/ }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: /^Connect Google/ }));
  await ui.findByRole("link", { name: "Continue with Google" });
  fireEvent.click(ui.getByRole("button", { name: "Use this device instead" }));
  await ui.findByText("Start on this device");
  await ui.findByText(/How would you like to use it/);
  assert.equal(readSetup().answers.storage, "device");
});

test("without the redirect flow, Google opens in a popup and setup continues to the workbook", async () => {
  let session = false;
  const ui = await open(
    <SetupAssistant
      {...props({
        loadConfig: async () => ({ ...config, persistentEnabled: false }),
        google: fakeGoogle({
          connect: async (clientId) => {
            calls.push(["connect", clientId]);
            session = true;
          },
          hasSession: () => session,
          account: () => "alex@harbor.example",
        }),
      })}
    />,
  );
  await intro(ui);
  await tags(ui, [/^Client handovers/]);
  await tags(ui, ["Matterport Pro2"]);
  await choose(ui, "Schematic floor plan");
  await choose(ui, "Confirm selection");
  await choose(ui, /^Connect Google/);
  await choose(ui, "Continue with Google");
  await ui.findByRole("button", { name: /^Create a new workbook/ });
  assert.deepEqual(calls, [["connect", config.clientId]]);
  assert(ui.getByRole("button", { name: /^Choose an existing workbook/ }));
});

test("start over clears answers only after confirmation", async () => {
  const ui = await open(<SetupAssistant {...props()} />);
  await say(ui, "What should I call you?", "Alex");
  await ui.findByText(/Nice to meet you/);
  window.confirm = () => false;
  fireEvent.click(ui.getByRole("button", { name: "Start over" }));
  assert.equal(readSetup().answers.name, "Alex");
  window.confirm = () => true;
  fireEvent.click(ui.getByRole("button", { name: "Start over" }));
  await ui.findByLabelText("What should I call you?");
  assert.equal(ui.queryByText(/Nice to meet you/), null);
  assert.deepEqual(JSON.parse(localStorage.getItem(SETUP_KEY)).answers, {});
});

test("saving publishes phone and service area with branding and keeps them for handovers", async () => {
  const { providerContact } = await import("./provider-contact.js");
  let state = newSetup();
  for (const [id, value] of [
    ["name", "Alex"],
    ["business", "Harbor Spatial"],
    [
      "contact",
      {
        email: "alex@harbor.example",
        phone: "5035550100",
        area: "Portland, OR",
        website: "",
      },
    ],
    ["focus", ["requests"]],
    ["hardware", ["dslr"]],
    ["deliverables", []],
    ["storage", "device"],
    ["pricingMethod", "skip"],
    ["aiUses", []],
    ["logo", null],
    ["welcome", ""],
    ["theme", "light"],
  ])
    state = answerStep(state, id, value, { online: true });
  localStorage.setItem(
    SETUP_KEY,
    JSON.stringify({ ...state, accountSubject: "subject-a" }),
  );
  const writes = [];
  const brandingApi = async (body, subject) => {
    if (body) {
      writes.push([body, subject]);
      return { available: true, version: 1, branding: body.branding };
    }
    return {
      subject: "subject-a",
      account: "a@b.co",
      available: true,
      version: 1,
      branding: {
        name: "Old",
        website: "https://old.example/",
        logo: "",
        shape: "rounded",
        phone: "(206) 555-0199",
      },
    };
  };
  const ui = await open(
    <SetupAssistant {...props({ brandingApi })} connected account="a@b.co" />,
  );
  await ui.findByText(
    /Save “Harbor Spatial”, your phone and service area to your client request pages/,
  );
  assert(ui.getByText(/Show your phone and service area on job handovers/));
  await choose(ui, "Save & finish");
  await ui.findByText("Business branding saved to your client pages");
  assert.deepEqual(writes[0][0].branding, {
    name: "Harbor Spatial",
    website: "https://old.example/",
    logo: "",
    shape: "rounded",
    phone: "(503) 555-0100",
    area: "Portland, OR",
  });
  assert.deepEqual(providerContact(), {
    phone: "(503) 555-0100",
    area: "Portland, OR",
  });
});

test("ChatGPT questions explain credits, set read-aloud and send built-in AI users to credits only when purchases are open", async () => {
  const seed = (storage) => {
    let state = newSetup();
    for (const [id, value] of [
      ["name", "Alex"],
      ["business", "Harbor Spatial"],
      ["contact", { email: "a@b.co", phone: "", area: "", website: "" }],
      ["focus", ["briefs"]],
      ["hardware", ["dslr"]],
      ["deliverables", []],
      ["storage", storage],
    ])
      state = answerStep(state, id, value, {
        online: true,
        googleAvailable: true,
      });
    localStorage.setItem(
      SETUP_KEY,
      JSON.stringify({ ...state, accountSubject: "subject-a" }),
    );
  };
  const packs = [
    { id: "10", amount: 1000, creditsMicros: 1 },
    { id: "25", amount: 2500, creditsMicros: 1 },
  ];
  // Device-only: credits need a Google account first.
  seed("device");
  let loads = 0;
  const loadCredits = async () => {
    loads++;
    return { enabled: true, packs };
  };
  const device = await open(<SetupAssistant {...props({ loadCredits })} />);
  const explain = await device.findByRole("link", {
    name: /How AI credits work/,
  });
  assert.equal(explain.getAttribute("href"), "/api/credits");
  assert.equal(explain.getAttribute("target"), "_blank");
  await tags(device, [/^Smart project briefs/, /^Ask about my projects/]);
  await choose(device, /^Read answers aloud/);
  assert.equal(localStorage.getItem("streamlion-read-answers-v1"), "true");
  await device.findByText(/Credits belong to a Google account/);
  assert.equal(loads, 0, "no credit lookup without a Google account");
  await choose(device, "OK, I’ll add credits later");
  await device.findByText("I’ll add credits later");
  cleanup();
  // Connected, purchases closed: keep the choice, no purchase link.
  localStorage.clear();
  seed("google");
  const connected = {
    connected: true,
    account: "a@b.co",
    workbookReady: true,
    bookId: "book",
  };
  const closed = await open(
    <SetupAssistant
      {...props({ loadCredits: async () => ({ enabled: false, packs: [] }) })}
      {...connected}
    />,
  );
  await tags(closed, [/^Smart project briefs/, /^Briefing Helper/]);
  await closed.findByText(/Credit purchases aren’t open yet/);
  assert.equal(closed.queryByRole("link", { name: /Add credits now/ }), null);
  cleanup();
  // Connected, purchases open: a new-tab link to the Credits page.
  localStorage.clear();
  seed("google");
  const ui = await open(
    <SetupAssistant {...props({ loadCredits })} {...connected} />,
  );
  await tags(ui, [/^Smart project briefs/, /^Briefing Helper/]);
  await ui.findByText(/Packs: \$10 · \$25/);
  const add = ui.getByRole("link", { name: /Add credits now/ });
  assert.equal(add.getAttribute("href"), "/api/credits");
  assert.equal(add.getAttribute("target"), "_blank");
  fireEvent.click(add);
  await ui.findByText("Opened credits & payment");
  await choose(ui, "Light");
  await choose(ui, "Save & finish");
  await ui.findByText(/Briefing Helper: create a project/);
});

test("a setup saved to the StreamLion account is restored on another device and saves back after each answer", async () => {
  const remote = answerStep(
    answerStep(newSetup("2026-10-01T00:00:00.000Z"), "name", "Alex", {}),
    "business",
    "Harbor Spatial",
    {},
  );
  const saved = [];
  const setupApi = async (state, subject) => {
    if (state) {
      saved.push([state, subject]);
      return { available: true, subject: "s", state };
    }
    return { available: true, subject: "s", state: remote };
  };
  const ui = await open(
    <SetupAssistant
      {...props({ setupApi, google: fakeGoogle({ hasSession: () => true }) })}
      connected
      account="a@b.co"
    />,
  );
  await ui.findByText("Restored from your StreamLion account");
  assert(ui.getByText(/Nice to meet you, Alex!/));
  assert.equal(readSetup().answers.business, "Harbor Spatial");
  assert.equal(saved.length, 0);
  const email = await ui.findByLabelText("Business email");
  fireEvent.change(email, { target: { value: "alex@harbor.example" } });
  await choose(ui, "Continue");
  await waitFor(() => assert.equal(saved.length, 1), { timeout: 2000 });
  assert.equal(saved[0][1], "s");
  assert.equal(saved[0][0].answers.contact.email, "alex@harbor.example");
  await ui.findByText("Saved to your StreamLion account");
});

function reviewFixture(complete = false) {
  let state = newSetup("2026-10-18T00:00:00.000Z");
  for (const [id, value] of [
    ["name", "Avery"],
    ["business", "QA Harbor Spatial (TEST)"],
    [
      "contact",
      {
        email: "qa@example.com",
        phone: "503-555-0142",
        area: "Portland",
        website: "",
      },
    ],
    ["focus", ["briefs"]],
    ["hardware", ["leica-blk360"]],
    ["deliverables", ["e57"]],
    ["storage", "device"],
    ["aiUses", []],
    ["theme", "light"],
    ...(complete ? [["review", true]] : []),
  ])
    state = answerStep(
      state,
      id,
      value,
      { online: true },
      "2026-10-18T00:00:01.000Z",
    );
  return { ...state, accountSubject: "subject-a" };
}

test("reopening a completed setup only displays review and never uploads an unfinished copy", async () => {
  const saved = reviewFixture(true),
    posts = [];
  localStorage.setItem(SETUP_KEY, JSON.stringify(saved));
  const setupApi = async (state) => {
    if (state) posts.push(state);
    return { available: true, subject: "subject-a", state: saved };
  };
  const ui = await open(
    <SetupAssistant
      {...props({ setupApi })}
      connected
      account="qa@example.com"
    />,
  );
  await ui.findByRole("button", { name: "Save & finish" });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
  assert.equal(posts.length, 0);
  assert.deepEqual(readSetup(), saved);
  assert.equal(readSetup().status, "complete");
});

test("Finish later waits for the last confirmed answer to reach the account before unmounting", async () => {
  const posts = [];
  let release,
    exited = false,
    ui;
  const setupApi = async (state, subject) => {
    if (!state) return { available: true, subject: "subject-a", state: null };
    posts.push([state, subject]);
    await new Promise((resolve) => {
      release = resolve;
    });
    return { available: true, subject, state };
  };
  ui = await open(
    <SetupAssistant
      {...props({
        setupApi,
        onExit: () => {
          exited = true;
          ui.unmount();
        },
      })}
      connected
      account="qa@example.com"
    />,
  );
  await say(ui, "What should I call you?", "Avery");
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(exited, false);
  assert.equal(posts[0][0].answers.name, "Avery");
  assert.equal(posts[0][1], "subject-a");
  await act(async () => release());
  await waitFor(() => assert.equal(exited, true));
});

test("Save & finish awaits its completion save and review afterwards does not change persisted state", async () => {
  const saved = reviewFixture(),
    posts = [];
  let release;
  const setupApi = async (state, subject) => {
    if (!state) return { available: true, subject: "subject-a", state: saved };
    posts.push(state);
    await new Promise((resolve) => {
      release = resolve;
    });
    return { available: true, subject, state };
  };
  const ui = await open(
    <SetupAssistant
      {...props({ setupApi, brandingApi: async () => ({ available: false }) })}
      connected
      account="qa@example.com"
    />,
  );
  await choose(ui, "Save & finish");
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].status, "complete");
  const next = ui.getByRole("button", { name: "Go to Projects" });
  assert.equal(
    next.disabled,
    true,
    "cannot navigate before the completion save settles",
  );
  await act(async () => release());
  await waitFor(() => assert.equal(next.disabled, false));
  const completed = readSetup();
  fireEvent.click(ui.getByRole("button", { name: "Review answers" }));
  await ui.findByRole("button", { name: "Save & finish" });
  assert.deepEqual(readSetup(), completed);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
  assert.equal(posts.length, 1);
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  await waitFor(() => assert.deepEqual(calls, [["exit"]]));
});

test("an in-place account switch hides the old transcript and never sends its answers to the new subject", async () => {
  const posts = [];
  let subject = "subject-a",
    release;
  const saved = reviewFixture(true);
  const setupApi = async (state, target) => {
    if (state) posts.push([state, target]);
    if (subject === "subject-b")
      await new Promise((resolve) => {
        release = resolve;
      });
    return {
      available: true,
      subject,
      state: subject === "subject-a" ? saved : null,
    };
  };
  const supplied = props({ setupApi });
  const ui = await open(
    <SetupAssistant {...supplied} connected account="qa-a@example.com" />,
  );
  await ui.findByRole("button", { name: "Save & finish" });
  subject = "subject-b";
  ui.rerender(
    <SetupAssistant {...supplied} connected account="qa-b@example.com" />,
  );
  assert.equal(ui.queryByRole("log", { name: "Setup conversation" }), null);
  await act(async () => release());
  await ui.findByLabelText("What should I call you?");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
  assert.equal(posts.length, 0);
  assert.notEqual(readSetup()?.answers.name, "Avery");
});

test("account save failure blocks navigation, keeps answers, and allows an explicit retry", async () => {
  let attempts = 0,
    exited = false;
  const setupApi = async (state, subject) => {
    if (!state) return { available: true, subject: "subject-a", state: null };
    if (++attempts === 1) throw Error("offline");
    return { available: true, subject, state };
  };
  const ui = await open(
    <SetupAssistant
      {...props({
        setupApi,
        onExit: () => {
          exited = true;
        },
      })}
      connected
      account="qa@example.com"
    />,
  );
  await say(ui, "What should I call you?", "Avery");
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  await ui.findByRole("alert");
  assert.equal(exited, false);
  assert.equal(readSetup().answers.name, "Avery");
  assert.equal(readSetup().accountSubject, "subject-a");
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  await waitFor(() => assert.equal(exited, true));
  assert.equal(attempts, 2);
});

test("device-only legacy answers require an explicit choice before account saving", async () => {
  const legacy = { ...reviewFixture(true) };
  delete legacy.accountSubject;
  localStorage.setItem(SETUP_KEY, JSON.stringify(legacy));
  const posts = [];
  const setupApi = async (state, subject) => {
    if (state) posts.push([state, subject]);
    return { available: true, subject: "subject-b", state: state || null };
  };
  const ui = await open(
    <SetupAssistant
      {...props({ setupApi })}
      connected
      account="qa@example.com"
    />,
  );
  const use = await ui.findByRole("button", {
    name: "Use this device’s setup for this account",
  });
  assert.equal(posts.length, 0);
  assert.equal(ui.queryByText("QA Harbor Spatial (TEST)"), null);
  fireEvent.click(use);
  await ui.findByRole("button", { name: "Save & finish" });
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0][1], "subject-b");
  assert.equal(posts[0][0].answers.name, "Avery");
});

test("an account switch cancels the previous account debounce without discarding its local answer", async () => {
  let subject = "subject-a";
  const posts = [];
  const setupApi = async (state, target) => {
    if (state) posts.push([state, target]);
    return { available: true, subject, state: null };
  };
  const supplied = props({ setupApi });
  const ui = await open(
    <SetupAssistant {...supplied} connected account="qa-a@example.com" />,
  );
  await say(ui, "What should I call you?", "Avery");
  subject = "subject-b";
  ui.rerender(
    <SetupAssistant {...supplied} connected account="qa-b@example.com" />,
  );
  await ui.findByLabelText("What should I call you?");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
  assert.equal(posts.length, 0);
  assert.equal(readSetup().accountSubject, "subject-b");
  const archived = JSON.parse(
    localStorage.getItem(`${SETUP_KEY}:account:subject-a`),
  );
  assert.equal(archived.answers.name, "Avery");
});
