import test from "node:test";
import assert from "node:assert/strict";
import { fetchRead } from "./network.js";
test("safe reads honor Retry-After, recover from a transient outage, and remain bounded", async () => {
  let calls = 0;
  const pauses = [];
  const response = await fetchRead(
    "/read",
    {},
    {
      fetcher: async () =>
        ++calls === 1
          ? new Response("busy", {
              status: 429,
              headers: { "Retry-After": "2" },
            })
          : new Response("ready"),
      pause: async (ms) => pauses.push(ms),
    },
  );
  assert.equal(calls, 2);
  assert.equal(pauses[0], 2000);
  assert.equal(await response.text(), "ready");
  calls = 0;
  const busy = await fetchRead(
    "/read",
    {},
    {
      fetcher: async () => {
        calls++;
        return new Response("busy", { status: 503 });
      },
      pause: async () => {},
    },
  );
  assert.equal(calls, 3);
  assert.equal(busy.status, 503);
});
test("mutations and access failures are never automatically replayed", async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    await fetchRead(
      "/read",
      {},
      {
        fetcher: async () => {
          calls++;
          return new Response("denied", { status });
        },
      },
    );
    assert.equal(calls, 1);
  }
  let writes = 0;
  await assert.rejects(
    fetchRead(
      "/write",
      { method: "POST" },
      {
        fetcher: async () => {
          writes++;
          throw new TypeError("acknowledgment lost");
        },
      },
    ),
    /acknowledgment lost/,
  );
  assert.equal(writes, 1);
});
test("long server retry delays and cancelled requests do not loop", async () => {
  let calls = 0;
  const response = await fetchRead(
    "/read",
    {},
    {
      fetcher: async () => {
        calls++;
        return new Response("busy", {
          status: 429,
          headers: { "Retry-After": "120" },
        });
      },
      pause: async () => assert.fail("must not pause"),
    },
  );
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchRead(
      "/read",
      { signal: controller.signal },
      {
        fetcher: async () => {
          throw new DOMException("cancelled", "AbortError");
        },
        pause: async () => assert.fail("must not retry"),
      },
    ),
    /cancelled/,
  );
});
