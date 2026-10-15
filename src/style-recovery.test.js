import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(
  new URL("../public/style-recovery-sw.js", import.meta.url),
  "utf8",
);
const cssURL = "https://app.example/assets/app-synthetic.css";
const css = () =>
  new Response("body { color: green; }", {
    headers: { "Content-Type": "text/css; charset=utf-8" },
  });
function fixture({ cached, network = css, extra = {} } = {}) {
  let listener,
    fetched = 0,
    writes = 0;
  const entries = new Map(cached ? [[cssURL, cached]] : []);
  const privateEntries = new Map([["project", new Response("private record")]]);
  const cache = {
    match: async (r) => entries.get(r.url)?.clone(),
    put: async (r, v) => {
      writes++;
      entries.set(r.url, v);
    },
  };
  runInNewContext(source, {
    self: {
      location: { origin: "https://app.example" },
      addEventListener: (type, fn) => {
        assert.equal(type, "fetch");
        listener = fn;
      },
    },
    URL,
    Response,
    caches: {
      keys: async () => [
        "private-records",
        "workbox-precache-v2-https://app.example/",
      ],
      open: async (name) => {
        assert(
          name.startsWith("workbox-precache-"),
          "must not open private caches",
        );
        return cache;
      },
    },
    fetch: async (request, options) => {
      fetched++;
      assert.equal(request.url, cssURL);
      assert.equal(options.cache, "reload");
      return network();
    },
    ...extra,
  });
  async function dispatch(overrides = {}) {
    let result;
    listener({
      request: {
        url: cssURL,
        method: "GET",
        destination: "style",
        ...overrides,
      },
      respondWith: (p) => {
        result = p;
      },
    });
    return result;
  }
  return {
    dispatch,
    entries,
    privateEntries,
    counts: () => ({ fetched, writes }),
  };
}
test("valid cached CSS remains usable offline without fetching or writing", async () => {
  const f = fixture({
    cached: css(),
    network: () => {
      throw Error("offline");
    },
  });
  assert.match(await (await f.dispatch()).text(), /color: green/);
  assert.deepEqual(f.counts(), { fetched: 0, writes: 0 });
});
test("HTTP-200 HTML in the stylesheet cache is repaired without touching other data", async () => {
  const f = fixture({
    cached: new Response("<html>workspace fallback</html>", {
      headers: { "Content-Type": "text/html" },
    }),
  });
  assert.match(await (await f.dispatch()).text(), /color: green/);
  assert.match(await f.entries.get(cssURL).clone().text(), /color: green/);
  assert.equal(await f.privateEntries.get("project").text(), "private record");
  assert.deepEqual(f.counts(), { fetched: 1, writes: 1 });
  await f.dispatch();
  assert.deepEqual(
    f.counts(),
    { fetched: 1, writes: 1 },
    "subsequent requests use repaired cache",
  );
});
test("a rollout HTML fallback is rejected and cannot become cached CSS", async () => {
  const bad = new Response("<html>not CSS</html>", {
    headers: { "Content-Type": "text/html" },
  });
  const f = fixture({ cached: bad, network: () => bad.clone() });
  assert.equal((await f.dispatch()).type, "error");
  assert.deepEqual(f.counts(), { fetched: 1, writes: 0 });
});
test("missing CSS can load from the network; failed cache reads do not discard valid network CSS", async () => {
  const f = fixture();
  assert.match(await (await f.dispatch()).text(), /color: green/);
  const broken = fixture({
    extra: {
      caches: {
        keys: async () => {
          throw Error("unavailable");
        },
      },
    },
  });
  assert.match(await (await broken.dispatch()).text(), /color: green/);
});
test("API requests, scripts, navigation, other origins and writes keep their existing handlers", async () => {
  const f = fixture();
  for (const request of [
    { url: "https://app.example/api/google/session" },
    {
      url: "https://app.example/assets/app-synthetic.js",
      destination: "script",
    },
    { destination: "document" },
    { url: "https://other.example/assets/app-synthetic.css" },
    { method: "POST" },
  ])
    assert.equal(await f.dispatch(request), undefined);
  assert.deepEqual(f.counts(), { fetched: 0, writes: 0 });
});
