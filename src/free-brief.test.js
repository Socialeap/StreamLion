import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  organizeFreeBrief,
  checklistText,
  initializeFreeBrief,
  FREE_BRIEF_LIMITS,
} from "./free-brief.js";
import {
  suggestTasks,
  validateBriefDraft,
  appendReviewedTasks,
} from "./brief-tasks.js";

const commercialBrief = readFileSync(
  new URL("./fixtures/riverside-commercial-brief.txt", import.meta.url),
  "utf8",
);

const fixtures = [
  {
    name: "structured sample",
    text: "Capture ground-floor living room + Kitchen.\nCheck Kitchen length and width.\nDeliver tour link, site notes and checked measurements.",
    kinds: ["capture", "capture", "measurement", "measurement", "delivery"],
    areas: ["ground-floor living room", "Kitchen", "Kitchen", "Kitchen", ""],
  },
  {
    name: "natural email",
    text: "Hi, could you please scan the lobby and kitchen and take photos of the reception desk? Please send the completed tour link to our team by Friday.",
    kinds: ["capture", "capture", "capture", "delivery"],
    areas: ["lobby", "kitchen", "reception desk", ""],
  },
  {
    name: "conditional multi-action sentence needs manual organization",
    text: "Scan the lobby and kitchen, measure the kitchen walls, but skip the locked office unless the manager opens it.",
    kinds: ["review"],
    areas: [""],
  },
  {
    name: "separate exclusion",
    text: "Capture lobby + kitchen.\nDo not capture the office.\nDeliver the tour link.",
    kinds: ["capture", "capture", "review", "delivery"],
    areas: ["lobby", "kitchen", "", ""],
  },
  {
    name: "skip office",
    text: "Capture lobby + kitchen.\nSkip the locked office.\nSend the finished link.",
    kinds: ["capture", "capture", "review", "delivery"],
    areas: ["lobby", "kitchen", "", ""],
  },
  {
    name: "except clause stays unresolved",
    text: "Capture lobby + kitchen except office.",
    kinds: ["review"],
    areas: [""],
  },
  {
    name: "dimensions before room",
    text: "Measure the length and width of the kitchen.\nRecord the ceiling height in the lobby.",
    kinds: ["measurement", "measurement", "measurement"],
    areas: ["kitchen", "kitchen", "lobby"],
    readings: ["Length", "Width", "Height"],
  },
  {
    name: "room before dimensions",
    text: "Check Kitchen length and width.\nMeasure Lobby height and width.",
    kinds: ["measurement", "measurement", "measurement", "measurement"],
    areas: ["Kitchen", "Kitchen", "Lobby", "Lobby"],
  },
  {
    name: "Oxford comma room list",
    text: "Capture the upstairs bedrooms, hallway, and kitchen.",
    kinds: ["capture", "capture", "capture"],
    areas: ["upstairs bedrooms", "hallway", "kitchen"],
  },
  {
    name: "access and deadline retained",
    text: "Access is after 9 AM; call Maya on arrival.\nCapture reception + conference room.\nSend tour and photos to Maya by Friday.",
    kinds: ["review", "review", "capture", "capture", "delivery"],
    areas: ["", "", "reception", "conference room", ""],
  },
  {
    name: "email bullet list",
    text: "Hi team,\n- Scan lobby and cafe\n- Measure the cafe width\n- Please exclude the storage room\n- Upload a tour link and floor plan",
    kinds: ["capture", "capture", "measurement", "review", "delivery"],
    areas: ["lobby", "cafe", "cafe", "", ""],
  },
  {
    name: "walkthrough wording preserves quantity and exclusion",
    text: "Our client needs a 3D walkthrough of the reception, two meeting rooms and the kitchen, plus photos of the exterior. The basement is out of scope.",
    kinds: ["capture", "capture", "capture", "capture", "review"],
    areas: ["reception", "two meeting rooms", "kitchen", "exterior", ""],
  },
  {
    name: "excluding never becomes a capture location",
    text: "Capture lobby, kitchen, excluding office.",
    kinds: ["review"],
    areas: [""],
  },
  {
    name: "semicolon actions",
    text: "Capture lobby; measure kitchen width; deliver tour link.",
    kinds: ["capture", "measurement", "delivery"],
    areas: ["lobby", "kitchen", ""],
  },
  {
    name: "mixed capture methods",
    text: "Scan the kitchen, and take photos of the living room.",
    kinds: ["capture", "capture"],
    areas: ["kitchen", "living room"],
  },
  {
    name: "prohibition followed by positive work",
    text: "Do not scan the office. Capture the lobby.",
    kinds: ["review", "capture"],
    areas: ["", "lobby"],
  },
];
for (const fixture of fixtures)
  test(`realistic brief: ${fixture.name}`, () => {
    const draft = organizeFreeBrief(fixture.text);
    assert.deepEqual(
      draft.suggestions.map((item) => item.kind),
      fixture.kinds,
    );
    assert.deepEqual(
      draft.suggestions.map((item) => item.area),
      fixture.areas,
    );
    if (fixture.readings)
      assert.deepEqual(
        draft.suggestions.map((item) => item.reading),
        fixture.readings,
      );
    for (const item of draft.suggestions) {
      assert.ok(
        fixture.text.includes(item.source.quote),
        "keep exact original source",
      );
      assert.ok(item.label.trim());
    }
    const exported = checklistText({ ...draft, reviewed: true });
    assert.doesNotMatch(exported, /Harbor House|Alex Morgan|HH-104|\$300/);
    if (fixture.kinds.includes("review"))
      assert.match(exported, /CLARIFY \/ OTHER/);
  });

test("restrictions, unknown measurements and contractions fail conservatively", () => {
  for (const text of [
    "Scan office if access is available",
    "Capture all rooms except storage",
    "Capture lobby, office isn’t available",
    "Scan office pending permission",
    "Capture the office only after approval",
    "Measure kitchen walls",
    "Check kitchen length and lobby width",
    "Measure the length and width of the kitchen and lobby",
    "Scan lobby or office",
    "Scan lobby and kitchen by Friday",
  ]) {
    assert.ok(
      organizeFreeBrief(text).suggestions.every(
        (item) => item.kind === "review",
      ),
      text,
    );
  }
});

test("empty, oversized and over-capacity briefs cannot fall back to sample work", () => {
  assert.throws(() => organizeFreeBrief("   "), /Paste/);
  assert.throws(
    () => organizeFreeBrief("x".repeat(FREE_BRIEF_LIMITS.text + 1)),
    /30,000/,
  );
  assert.throws(
    () => organizeFreeBrief("x".repeat(FREE_BRIEF_LIMITS.passage + 1)),
    /long brief passages/,
  );
  assert.throws(
    () => organizeFreeBrief(Array(301).fill("Scan lobby").join("\n")),
    /smaller section/,
  );
  const draft = organizeFreeBrief("Scan lobby");
  assert.throws(() => checklistText(draft), /Review/);
  draft.suggestions[0].selected = false;
  assert.throws(
    () => checklistText({ ...draft, reviewed: true }),
    /Select at least one/,
  );
});

function setup(t) {
  const dom = new JSDOM(
    readFileSync(new URL("../api/welcome.html", import.meta.url), "utf8"),
    { url: "https://streamlion.example/api/welcome" },
  );
  const { document } = dom.window;
  initializeFreeBrief(document, dom.window);
  t.after(() => dom.window.close());
  const get = (id) => document.getElementById(`free-brief-${id}`);
  const change = (node, value) => {
    node.value = value;
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const organize = (text) => {
    change(get("input"), text);
    get("organize").click();
  };
  return { dom, document, get, change, organize };
}

test("landing flow: organize, correct type, add missing task, review, copy, edit and clear", async (t) => {
  const { dom, document, get, change, organize } = setup(t);
  let copied;
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        copied = text;
      },
    },
  });
  organize("Please scan lobby and kitchen. Measure kitchen walls.");
  assert.equal(get("tasks").children.length, 3);
  assert.equal(get("copy").disabled, true);
  const unresolved = get("tasks").lastElementChild;
  change(unresolved.querySelector("select"), "measurement");
  change(
    unresolved.querySelectorAll('input:not([type="checkbox"])')[0],
    "Check kitchen height against the tape",
  );
  change(
    unresolved.querySelectorAll('input:not([type="checkbox"])')[1],
    "kitchen",
  );
  get("reviewed").click();
  assert.equal(get("copy").disabled, true, "missing dimension blocks export");
  change(unresolved.querySelectorAll("select")[1], "Height");
  unresolved.querySelector("button").click();
  assert.equal(get("tasks").children.length, 4);
  change(
    get("tasks").lastElementChild.querySelector('input:not([type="checkbox"])'),
    "Confirm wall measurement scope with the client",
  );
  get("reviewed").click();
  assert.equal(get("copy").disabled, false);
  get("copy").click();
  await Promise.resolve();
  assert.match(copied, /Check kitchen height/);
  assert.match(copied, /Confirm wall measurement scope/);
  assert.match(copied, /Source: Measure kitchen walls\./);
  change(
    get("tasks").querySelector('input:not([type="checkbox"])'),
    "Scan main lobby",
  );
  assert.equal(get("reviewed").checked, false);
  assert.equal(get("download").disabled, true);
  get("clear").click();
  assert.equal(get("input").value, "");
  assert.equal(get("results").hidden, true);
  assert.equal(get("tasks").children.length, 0);
  assert.equal(document.activeElement, get("input"));
  get("organize").click();
  assert.match(get("status").textContent, /Paste/);
});

test("HTML-like client text stays text, stale results disappear, clipboard failure has a download fallback", async (t) => {
  const { dom, document, get, change, organize } = setup(t);
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  organize('Scan lobby.\n<img src=x onerror="alert(1)">');
  assert.equal(get("tasks").querySelector("img"), null);
  assert.equal(
    document.querySelectorAll("#free-brief-results script").length,
    0,
  );
  get("reviewed").click();
  get("copy").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(get("status").textContent, /Download checklist/);
  change(get("input"), "Scan another room");
  assert.equal(get("results").hidden, true);
  assert.equal(get("tasks").children.length, 0);
  organize("x".repeat(FREE_BRIEF_LIMITS.text + 1));
  assert.equal(get("results").hidden, true);
  assert.match(get("status").textContent, /30,000/);
});

test("the full commercial email organizes and exports without the project checklist ceiling", () => {
  assert.throws(
    () => suggestTasks({ project: {}, text: commercialBrief }),
    /40 requirements/,
  );
  const draft = organizeFreeBrief(commercialBrief);
  assert.ok(draft.suggestions.length > 40);
  assert.ok(
    draft.suggestions.every((item) =>
      commercialBrief.includes(item.source.quote),
    ),
  );
  assert.ok(
    draft.suggestions
      .filter((item) => item.source.quote.startsWith("For Cedar and Maple"))
      .every((item) => item.kind === "review"),
  );
  const output = checklistText({ ...draft, reviewed: true });
  assert.ok(
    output.includes(commercialBrief),
    "keep the complete original, including headings and sign-off",
  );
  for (const phrase of [
    "server room and electrical cupboard",
    "normally locked",
    "Thursday afternoon",
    "window dimensions",
    "not be publicly listed",
  ])
    assert.ok(output.includes(phrase), phrase);
  assert.throws(() => validateBriefDraft(draft), /cannot be read/);
  assert.throws(
    () => appendReviewedTasks([], { ...draft, reviewed: true }),
    /cannot be read/,
  );
});

test("large free scopes keep every task beyond 40 while default project limits stay strict", () => {
  const text = Array.from(
    { length: 120 },
    (_, i) => `Capture Level ${Math.floor(i / 30) + 1} room ${i + 1}.`,
  ).join("\n");
  const draft = organizeFreeBrief(text);
  assert.equal(draft.suggestions.length, 120);
  const output = checklistText({ ...draft, reviewed: true });
  assert.match(output, /120\. \[ \] Capture Level 4 room 120/);
  assert.throws(
    () => suggestTasks({ project: {}, text, limits: FREE_BRIEF_LIMITS }),
    /40 requirements/,
  );
  assert.throws(
    () => validateBriefDraft({ ...draft, limits: FREE_BRIEF_LIMITS }),
    /cannot be read/,
  );
  const paragraph =
    "Additional site access information: " +
    "Keep the rear delivery route clear during capture, ".repeat(30);
  assert.ok(paragraph.length > 1000 && paragraph.length < 4000);
  const longDraft = organizeFreeBrief(paragraph);
  assert.ok(
    checklistText({ ...longDraft, reviewed: true }).includes(paragraph),
  );
});

test("standalone export retains repeated task names from separate floor scopes", () => {
  const text = "LEVEL 1\nCapture corridor.\nLEVEL 2\nCapture corridor.";
  const draft = organizeFreeBrief(text);
  const output = checklistText({ ...draft, reviewed: true });
  assert.equal((output.match(/\[ \] Capture corridor/g) || []).length, 2);
  assert.ok(output.includes(text));
});

test("commercial scope pages preserve edits and export all pages after review", async (t) => {
  const { dom, get, change, organize } = setup(t);
  let copied;
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        copied = text;
      },
    },
  });
  organize(commercialBrief);
  const total = organizeFreeBrief(commercialBrief).suggestions.length;
  assert.equal(get("tasks").children.length, 20);
  assert.match(
    get("page-status").textContent,
    new RegExp(`of ${total} suggestions`),
  );
  get("reviewed").click();
  assert.equal(get("copy").disabled, true);
  assert.match(get("status").textContent, /remaining .* pages/);
  change(
    get("tasks").querySelector('input:not([type="checkbox"])'),
    "Confirm overall capture scope with client",
  );
  get("tasks").querySelector('input[type="checkbox"]').click();
  while (!get("next").disabled) get("next").click();
  assert.ok(get("tasks").children.length <= 20);
  get("reviewed").click();
  assert.equal(get("copy").disabled, false);
  get("copy").click();
  await Promise.resolve();
  assert.ok(copied.includes(commercialBrief));
  assert.match(copied, /Thursday afternoon/);
  assert.doesNotMatch(
    copied,
    /\[ \] Confirm overall capture scope with client/,
  );
  get("previous").click();
  get("previous").click();
  get("previous").click();
  assert.equal(
    get("tasks").querySelector('input:not([type="checkbox"])').value,
    "Confirm overall capture scope with client",
  );
  assert.equal(
    get("tasks").querySelector('input[type="checkbox"]').checked,
    false,
  );
  get("clear").click();
  organize("Scan lobby");
  assert.equal(get("pages").hidden, true);
});

test("adding a task at a page boundary focuses the new task and keeps review gated", (t) => {
  const { get, change, organize } = setup(t);
  organize(
    Array.from({ length: 40 }, (_, i) => `Capture Room ${i + 1}.`).join("\n"),
  );
  get("tasks").lastElementChild.querySelector("button").click();
  assert.match(get("page-status").textContent, /Page 2 of 3/);
  change(
    get("tasks").firstElementChild.querySelector(
      'input:not([type="checkbox"])',
    ),
    "Confirm extra room access",
  );
  get("reviewed").click();
  assert.equal(get("copy").disabled, true);
  get("next").click();
  get("reviewed").click();
  assert.equal(get("copy").disabled, false);
});

test("a delayed clipboard response cannot replace the clear confirmation", async (t) => {
  const { dom, get, organize } = setup(t);
  let completeCopy;
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: {
      writeText: () =>
        new Promise((resolve) => {
          completeCopy = resolve;
        }),
    },
  });
  organize("Scan lobby");
  get("reviewed").click();
  get("copy").click();
  get("clear").click();
  completeCopy();
  await Promise.resolve();
  assert.match(get("status").textContent, /cleared/);
  assert.equal(get("copy").disabled, true);
});
