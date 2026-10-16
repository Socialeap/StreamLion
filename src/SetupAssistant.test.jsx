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
const { SETUP_KEY, readSetup } = await import("./setup-assistant.js");
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
  assert(ui.getByText("Step 1 of 6 · About you"));
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
  assert(ui.getByText("Step 2 of 6 · Contact"));
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
  await ui.findByText(/add your logo/);
  await choose(ui, "Skip for now");
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
  await ui.findByText(/add your logo/);
  await choose(ui, "Skip for now");
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
  await choose(ui, "Skip for now");
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
  await ui.findByText(/which look do you prefer/);
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
  const { answerStep, newSetup } = await import("./setup-assistant.js");
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
    ["logo", null],
    ["theme", "light"],
  ])
    state = answerStep(state, id, value, { online: true });
  localStorage.setItem(SETUP_KEY, JSON.stringify(state));
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
