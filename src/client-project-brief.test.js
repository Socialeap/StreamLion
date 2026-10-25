import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { intakeFor, parseIntake } from "./project-schema.js";

const fixtureText = readFileSync(
  new URL("../test/fixtures/client-project-brief.json", import.meta.url),
  "utf8",
);
const fixture = JSON.parse(fixtureText);
const portableKeys = [
  "title",
  "propertySizeSqFt",
  "city",
  "region",
  "scope",
  "deliverables",
  "proposedTimes",
  "notes",
];

test("the portable client fixture imports without an address, contacts or payment fields", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.kind, "streamlion.project");
  assert.deepEqual(
    Object.keys(fixture.fields).sort(),
    [...portableKeys].sort(),
  );
  const fields = parseIntake(fixtureText);
  for (const key of portableKeys) {
    assert.equal(typeof fixture.fields[key], "string");
    assert.equal(fields[key], fixture.fields[key]);
  }
  // The existing parser may populate empty optional fields, but must not invent
  // an address, agreement, appointment, payment or other project data.
  for (const [key, value] of Object.entries(fields)) {
    if (!portableKeys.includes(key)) assert.equal(value, "", key);
  }
  assert.deepEqual(parseIntake(JSON.stringify(intakeFor(fields))), fields);
});

test("client briefs use the existing strict import boundary", () => {
  const withFields = (fields) => JSON.stringify({ ...fixture, fields });
  assert.throws(() =>
    parseIntake(withFields({ ...fixture.fields, privateAccessCode: "1234" })),
  );
  assert.throws(() =>
    parseIntake(withFields({ ...fixture.fields, propertySizeSqFt: "-1" })),
  );
  assert.throws(() =>
    parseIntake(JSON.stringify({ ...fixture, schemaVersion: 2 })),
  );
  assert.throws(() =>
    parseIntake(JSON.stringify({ ...fixture, approved: true })),
  );
});

test("the client entry names the browser brief and preserves the provider entry", () => {
  const document = new JSDOM(
    readFileSync(new URL("../api/welcome.html", import.meta.url), "utf8"),
  ).window.document;
  const actions = [...document.querySelectorAll(".hero-actions a")];
  assert.equal(actions.length, 2);
  assert.equal(actions[0].getAttribute("href"), "/api/client-requests");
  assert.match(actions[0].textContent, /I’m a capture provider/);
  assert.equal(
    actions[1].getAttribute("href"),
    "https://www.frontiers3d.com/directory#project-brief",
  );
  assert.match(actions[1].textContent, /Plan your capture project/);
  const faq = [...document.querySelectorAll("#questions details")]
    .find((item) =>
      item
        .querySelector("summary")
        .textContent.includes("before choosing a provider"),
    )
    .textContent.replace(/\s+/g, " ");
  assert.match(faq, /free in your browser, with no signup or AI/);
  assert.match(faq, /explicitly save on this device or download a copy/);
  assert.match(faq, /review the exact snapshot and selected recipient/);
  assert.match(faq, /No exact address or access codes/);
  assert.match(faq, /local draft to review together, not an approved scope/);
  assert.match(faq, /does not automatically write to Google/);
  const workflow = document.querySelector("#workflow").textContent.replace(/\s+/g, " ");
  assert.match(workflow, /opted-in F3D listing/);
  assert.match(faq, /provider must verify their email and enroll free on F3D/);
  assert.match(faq, /No Core purchase is required/);
  assert.match(faq, /no email is sent automatically/);
  assert.match(faq, /Clients can revoke access or delete the stored brief and reply/);
  assert.match(faq, /Downloaded or shared copies cannot be revoked/);
  assert.doesNotMatch(workflow, /A client finds you through/);
});
