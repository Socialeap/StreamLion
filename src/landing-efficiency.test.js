import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { initializeEfficiency } from "./landing-efficiency.js";
import { navigationFallbackDenylist } from "../vite.config.js";

const html = readFileSync(
  new URL("../api/welcome.html", import.meta.url),
  "utf8",
);
test("each phase exposes its saving and selection replaces the prior phase", () => {
  const document = new JSDOM(html).window.document;
  initializeEfficiency(document);
  const buttons = [...document.querySelectorAll("[data-efficiency-phase]")];
  assert.equal(buttons.length, 4);
  for (const [index, saving] of [33, 35, 45, 40].entries()) {
    buttons[index].click();
    assert.match(
      document.querySelector("#efficiency-detail").textContent,
      new RegExp(`${saving} min saved`),
    );
    assert.equal(
      buttons.filter((button) => button.getAttribute("aria-pressed") === "true")
        .length,
      1,
    );
    assert.equal(buttons[index].getAttribute("aria-pressed"), "true");
  }
  assert.match(
    document.querySelector("#efficiency-detail").textContent,
    /rework can still occur/,
  );
});
test("the comparison and qualification remain readable without JavaScript", () => {
  const document = new JSDOM(html).window.document;
  const section = document.querySelector("#efficiency");
  assert.match(section.textContent, /270 → 117 minutes/);
  assert.match(section.textContent, /not a guarantee/);
  assert.equal(
    section.querySelector("a").getAttribute("href"),
    "/efficiency.html",
  );
  assert.equal(section.nextElementSibling.id, "value");
});
test("white paper routes bypass the installed app navigation fallback", () => {
  for (const route of [
    "/efficiency",
    "/efficiency.html",
    "/efficiency.html?from=landing",
  ]) {
    assert(
      navigationFallbackDenylist.some((pattern) => pattern.test(route)),
      route,
    );
  }
  const paper = new JSDOM(
    readFileSync(new URL("../public/efficiency.html", import.meta.url), "utf8"),
  ).window.document;
  assert.equal(
    paper.querySelector("tfoot").textContent.replace(/\s+/g, " ").trim(),
    "Total 270 117 153",
  );
  assert.match(paper.body.textContent, /not a\s+controlled study/);
  assert.equal(
    paper.querySelector(".paper-button").getAttribute("href"),
    "/api/welcome#value",
  );
});
