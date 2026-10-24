import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { initializeLandingPilot } from "./landing-pilot.js";

const available = {
  enabled: true,
  interestOpen: true,
  applicationsOpen: true,
  admissionMode: "instant",
  availability: "available",
  durationDays: 7,
};
function setup(t, config = available) {
  const dom = new JSDOM(
    readFileSync(new URL("../api/welcome.html", import.meta.url), "utf8"),
    { url: "https://streamlion.example/api/welcome" },
  );
  let response = config;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (response instanceof Error) throw response;
    return { ok: true, json: async () => response };
  };
  const controller = initializeLandingPilot(dom.window.document, dom.window, {
    fetchImpl,
  });
  t.after(() => {
    controller.dispose();
    dom.window.close();
  });
  return {
    ...dom.window,
    document: dom.window.document,
    window: dom.window,
    controller,
    requests,
    card: () => dom.window.document.querySelector("#landing-pilot"),
    change: (value) => {
      response = value;
    },
  };
}

test("instant available card follows hero, preserves sample, and exposes Core scope", async (t) => {
  const ui = setup(t);
  await ui.controller.ready;
  const card = ui.card();
  assert.equal(ui.document.querySelector(".hero").nextElementSibling, card);
  assert.ok(ui.document.querySelector("#demo"));
  assert.match(card.textContent, /Take StreamLion on a real capture job/);
  assert.match(card.textContent, /7-day/);
  assert.equal(card.querySelector("a").textContent, "Start free pilot");
  assert.equal(card.querySelector("a").getAttribute("href"), "/pilot/");
  assert.match(
    card.textContent,
    /No card · No purchase obligation · No automatic charge/,
  );
  const details = card.querySelector("button");
  assert.equal(details.getAttribute("aria-expanded"), "false");
  details.click();
  assert.equal(details.getAttribute("aria-expanded"), "true");
  assert.equal(card.querySelector("#landing-pilot-details").hidden, false);
  assert.match(card.textContent, /Google save and exports/);
  assert.match(
    card.textContent,
    /Paid AI, hosted voice and client-portal automation are excluded/,
  );
  assert.equal(ui.requests[0].options.cache, "no-store");
  assert.ok(ui.requests[0].options.signal);
});

test("only truly full availability shows full notice with planned opening copy", async (t) => {
  const ui = setup(t, { ...available, availability: "full" });
  await ui.controller.ready;
  assert.match(ui.card().textContent, /Update: this pilot group is full\./);
  assert.match(
    ui.card().textContent,
    /More pilot places are planned\. Join the interest list for news of the next opening\./,
  );
  assert.equal(ui.card().querySelector("a").textContent, "Join interest list");
  assert.doesNotMatch(ui.card().textContent, /7-day|soon|Start free pilot/);
});

test("closed interest mode is honest and manual mode retains approval", async (t) => {
  const ui = setup(t, {
    ...available,
    applicationsOpen: false,
    availability: "closed",
    reopenAt: "<img src=x>",
  });
  await ui.controller.ready;
  assert.doesNotMatch(
    ui.card().textContent,
    /group is full|soon|7-day|Start free pilot/,
  );
  assert.match(ui.card().textContent, /Pilot access is currently closed/);
  assert.equal(ui.card().querySelector("img"), null);
  ui.change({ ...available, admissionMode: "manual", durationDays: 14 });
  await ui.controller.refresh();
  assert.match(ui.card().textContent, /manual approval required/);
  assert.match(ui.card().textContent, /14-day/);
  assert.equal(ui.card().querySelector("a").textContent, "Register interest");
});

test("disabled and unavailable closed states offer no card or pilot entry", async (t) => {
  const ui = setup(t, { ...available, enabled: false });
  await ui.controller.ready;
  assert.equal(ui.card(), null);
  ui.change({
    ...available,
    interestOpen: false,
    applicationsOpen: false,
    availability: "closed",
  });
  await ui.controller.refresh();
  assert.equal(ui.card(), null);
});

test("updates replace state without duplicate cards, and focus refreshes availability", async (t) => {
  const ui = setup(t);
  await ui.controller.ready;
  assert.equal(initializeLandingPilot(ui.document, ui.window), ui.controller);
  ui.change({ ...available, availability: "full" });
  ui.window.dispatchEvent(new ui.window.Event("focus"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(ui.card().textContent, /group is full/);
  assert.equal(ui.document.querySelectorAll("#landing-pilot").length, 1);
  ui.change({ ...available, durationDays: 14 });
  await ui.controller.refresh();
  assert.match(ui.card().textContent, /14-day/);
  assert.doesNotMatch(ui.card().textContent, /group is full/);
});

test("outage removes optimistic offer and later confirmation can restore it", async (t) => {
  const ui = setup(t);
  await ui.controller.ready;
  ui.change(new Error("offline"));
  await ui.controller.refresh();
  assert.equal(ui.card(), null);
  ui.change(available);
  await ui.controller.refresh();
  assert.equal(ui.card().querySelector("a").textContent, "Start free pilot");
});

test("malformed available policy fails closed and disposal prevents late rendering", async (t) => {
  const ui = setup(t, { ...available, durationDays: "<script>" });
  await ui.controller.ready;
  assert.equal(ui.card(), null);
  ui.controller.dispose();
  await ui.controller.refresh();
  assert.equal(ui.card(), null);
});

test("a revalidation disables the old action until the new policy arrives", async (t) => {
  const dom = new JSDOM(
    '<main><section class="hero"></section><section id="demo"></section></main>',
  );
  let resolve;
  let calls = 0;
  const controller = initializeLandingPilot(dom.window.document, dom.window, {
    fetchImpl: () =>
      ++calls === 1
        ? Promise.resolve({ ok: true, json: async () => available })
        : new Promise((done) => {
            resolve = done;
          }),
  });
  t.after(() => {
    controller.dispose();
    dom.window.close();
  });
  await controller.ready;
  const refreshing = controller.refresh();
  const link = dom.window.document.querySelector("#landing-pilot a");
  assert.equal(link.hasAttribute("href"), false);
  assert.equal(link.getAttribute("aria-disabled"), "true");
  await Promise.resolve();
  resolve({ ok: false });
  await refreshing;
  assert.equal(dom.window.document.querySelector("#landing-pilot"), null);
});

test("returning from the back-forward cache refreshes rather than permanently hiding the offer", async (t) => {
  const ui = setup(t);
  await ui.controller.ready;
  ui.window.dispatchEvent(
    new ui.window.PageTransitionEvent("pagehide", { persisted: true }),
  );
  ui.change({ ...available, availability: "full" });
  ui.window.dispatchEvent(
    new ui.window.PageTransitionEvent("pageshow", { persisted: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(ui.card()?.textContent || "", /group is full/);
});

test("a synchronous fetch failure can recover on a later refresh", async (t) => {
  const dom = new JSDOM('<main><section class="hero"></section></main>');
  let unavailable = true;
  const controller = initializeLandingPilot(dom.window.document, dom.window, {
    fetchImpl: () => {
      if (unavailable) throw new Error("unavailable");
      return Promise.resolve({ ok: true, json: async () => available });
    },
  });
  t.after(() => {
    controller.dispose();
    dom.window.close();
  });
  await controller.ready;
  unavailable = false;
  await controller.refresh();
  assert.equal(
    dom.window.document.querySelector("#landing-pilot a")?.textContent,
    "Start free pilot",
  );
});
