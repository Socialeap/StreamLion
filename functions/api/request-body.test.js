import test from "node:test";
import assert from "node:assert/strict";
import { boundedText, boundedBytes } from "../../server/request-body.js";
import { handleExtensionAuth } from "../../server/extension-auth.js";
import { extensionFixture } from "../../test/extension-fixture.js";

function streamed(chunks, headers = {}) {
  let reads = 0,
    cancelled = false;
  const stream = new ReadableStream(
    {
      pull(controller) {
        reads++;
        if (chunks.length) controller.enqueue(chunks.shift());
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    request: new Request("https://app.example/api/extension/token", {
      method: "POST",
      body: stream,
      duplex: "half",
      headers,
    }),
    counts: () => ({ reads, cancelled }),
  };
}

test("streamed OAuth bodies are cancelled at the byte limit, regardless of advertised length", async () => {
  for (const headers of [{}, { "Content-Length": "1" }]) {
    const body = streamed(
      Array.from({ length: 32 }, () => new Uint8Array(4096)),
      headers,
    );
    const f = await extensionFixture();
    const response = await handleExtensionAuth({
      request: body.request,
      env: f.env,
      params: { path: ["token"] },
    });
    assert.equal(response.status, 413);
    assert.deepEqual(body.counts(), { reads: 3, cancelled: true });
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) AS n FROM streamlion_extension_tokens_v1")
        .get().n,
      0,
    );
    f.db.close();
  }
});
test("oversized first chunks and Content-Length are rejected without draining", async () => {
  const large = streamed([new Uint8Array(13000), new Uint8Array(100)]);
  await assert.rejects(() => boundedText(large.request, 12000), {
    status: 413,
  });
  assert.deepEqual(large.counts(), { reads: 1, cancelled: true });
  const advertised = streamed([new Uint8Array(100)], {
    "Content-Length": "13000",
  });
  await assert.rejects(() => boundedText(advertised.request, 12000), {
    status: 413,
  });
  assert.deepEqual(advertised.counts(), { reads: 0, cancelled: true });
});
test("UTF-8 limits count bytes and decoding preserves characters split across chunks", async () => {
  const encoder = new TextEncoder();
  const multibyte = streamed([encoder.encode("é".repeat(6001))]);
  await assert.rejects(() => boundedText(multibyte.request, 12000), {
    status: 413,
  });
  const exact = streamed([encoder.encode("a".repeat(12000))]);
  assert.equal((await boundedText(exact.request, 12000)).length, 12000);
  const split = streamed([new Uint8Array([0xc3]), new Uint8Array([0xa9])]);
  assert.equal(await boundedText(split.request, 12000), "é");
  const invalid = streamed([new Uint8Array([0xff])]);
  await assert.rejects(() => boundedText(invalid.request, 12000), {
    status: 400,
  });
});
test("bounded binary verification preserves exact bytes and cancels oversized streams", async () => {
  const binary = streamed([new Uint8Array([0, 255]), new Uint8Array([128, 1])]);
  assert.deepEqual(
    await boundedBytes(binary.request, 4),
    new Uint8Array([0, 255, 128, 1]),
  );
  const tooLarge = streamed([
    new Uint8Array(3),
    new Uint8Array(3),
    new Uint8Array(3),
  ]);
  await assert.rejects(() => boundedBytes(tooLarge.request, 5), {
    status: 413,
  });
  assert.deepEqual(tooLarge.counts(), { reads: 2, cancelled: true });
});
