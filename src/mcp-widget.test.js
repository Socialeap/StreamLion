import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { STREAMLION_WIDGET_HTML } from "./mcp-widget.js";

test("in-chat card renders only synthetic data and opens the workspace on request", async () => {
  let displayMode;
  const dom = new JSDOM(STREAMLION_WIDGET_HTML, {
    url: "https://streamlion.transcendencemedia.com/",
    runScripts: "dangerously",
    beforeParse(window) {
      window.openai = {
        toolOutput: {
          kind: "sample",
          title: "Example venue capture",
          city: "Brooklyn",
          visit: "Date to confirm",
          review: "Draft",
        },
        requestDisplayMode: async (options) => {
          displayMode = options.mode;
        },
      };
    },
  });

  assert.equal(dom.window.document.querySelector("#title").textContent, "Example venue capture");
  assert.equal(dom.window.document.querySelector("#city").textContent, "Brooklyn");
  assert.equal(dom.window.document.querySelector("#workspace iframe"), null);

  dom.window.document.querySelector("#in-chat").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(displayMode, "fullscreen");
  assert.equal(
    dom.window.document.querySelector("#workspace iframe").src,
    "https://streamlion.transcendencemedia.com/",
  );
  dom.window.close();
});
