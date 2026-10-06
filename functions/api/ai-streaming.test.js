import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  streamSpeech,
  takePhrase,
  projectContext,
  SPEECH_PCM,
} from "../../server/ai-providers.js";

const pcmResponse = (body) =>
  new Response(body, { headers: { "Content-Type": "audio/pcm" } });
const collect = async (generator) => {
  const chunks = [];
  for await (const chunk of generator)
    chunks.push(Buffer.from(chunk, "base64"));
  return Buffer.concat(chunks);
};

test("speech streams before EOF and preserves samples across odd network boundaries", async () => {
  let controller,
    cancelled = false;
  const bytes = Uint8Array.from({ length: 13002 }, (_, i) => i % 256);
  const generator = streamSpeech(
    {},
    "Exact 6 7/16 inches.",
    new AbortController().signal,
    async () =>
      pcmResponse(
        new ReadableStream({
          start(c) {
            controller = c;
            c.enqueue(bytes.slice(0, 2401));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const first = await generator.next();
  assert.equal(first.done, false);
  assert.deepEqual(
    Buffer.from(first.value, "base64"),
    Buffer.from(bytes.slice(0, 2400)),
  );
  controller.enqueue(bytes.slice(2401, 5001));
  controller.enqueue(bytes.slice(5001));
  controller.close();
  const rest = await collect(generator);
  assert.deepEqual(
    Buffer.concat([Buffer.from(first.value, "base64"), rest]),
    Buffer.from(bytes),
  );
  assert.equal(cancelled, false); // Closed normally; no leaked reader lock.
});

test("speech rejects malformed/oversized audio and never retries another endpoint", async () => {
  for (const response of [
    Response.json({ audio: "secret provider detail" }),
    new Response("unavailable", { status: 503 }),
    pcmResponse(new Uint8Array(1)),
    pcmResponse(new Uint8Array(SPEECH_PCM.maxBytes + 1)),
    pcmResponse(Buffer.from("RIFFbroken")),
  ]) {
    let calls = 0;
    await assert.rejects(
      collect(
        streamSpeech({}, "q", new AbortController().signal, async () => {
          calls++;
          return response;
        }),
      ),
    );
    assert.equal(calls, 1);
  }
});

test("stalled first audio times out and cancels the reader; user stop also cancels pending reads", async () => {
  let cancelled = 0;
  const fetcher = async () =>
    pcmResponse(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    );
  await assert.rejects(
    collect(
      streamSpeech({}, "q", new AbortController().signal, fetcher, {
        firstMs: 15,
        idleMs: 15,
      }),
    ),
    /stopped/,
  );
  assert.equal(cancelled, 1);
  const controller = new AbortController();
  const pending = collect(streamSpeech({}, "q", controller.signal, fetcher));
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, /stopped/);
  assert.equal(cancelled, 2);
});

test("speech idle deadline bounds gaps after first audio", async () => {
  let cancelled = false;
  const generator = streamSpeech(
    {},
    "q",
    new AbortController().signal,
    async () =>
      pcmResponse(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(2400));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    { firstMs: 100, idleMs: 15 },
  );
  assert.equal((await generator.next()).done, false);
  await assert.rejects(generator.next(), /stopped/);
  assert.equal(cancelled, true);
});

test("early phrase handoff retains decimals, fractions, units and abbreviations", () => {
  assert.deepEqual(takePhrase("It is Harbor House. Next"), [
    "It is Harbor House. ",
    "Next",
  ]);
  assert.deepEqual(takePhrase("Clearance is 5."), ["", "Clearance is 5."]);
  assert.deepEqual(
    takePhrase("Clearance is 5.5 inches and 6 7/16 inches. Next"),
    ["Clearance is 5.5 inches and 6 7/16 inches. ", "Next"],
  );
  assert.deepEqual(takePhrase("Ask Dr. Smith at the site. Next"), [
    "Ask Dr. Smith at the site. ",
    "Next",
  ]);
  assert.deepEqual(takePhrase("6 7/16 inches", true), ["6 7/16 inches", ""]);
  const context = JSON.parse(
    projectContext({ title: "House", address: "", finished: false, count: 0 }, [
      { text: "6 7/16 inches", reviewed: false },
    ]),
  );
  assert.equal(context.project.address, undefined);
  assert.equal(context.project.finished, false);
  assert.equal(context.project.count, 0);
  assert.equal(context.fieldRecords[0].reviewed, false);
});

test("Kokoro PCM streaming and cleanup work in the actual Workers runtime", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-23",
      compatibilityFlags: ["nodejs_compat"],
      script: `const SPEECH_PCM = ${JSON.stringify(SPEECH_PCM)};
      ${streamSpeech.toString()}
      export default { async fetch() {
        let cancelled = false, calls = 0;
        const fakeFetch = async (url, init) => {
          const request = new Request(url, init);
          if (request.redirect !== 'manual' || request.headers.get('xi-api-key') !== 'synthetic') throw new Error('invalid_request');
          calls++;
          return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2401)); }, cancel() { cancelled = true; } }), {headers:{'Content-Type':'audio/pcm'}});
        };
        const audio = streamSpeech({DEEPINFRA_API_KEY:'synthetic'}, '6 7/16 inches.', new AbortController().signal, fakeFetch);
        const frame = await audio.next();
        await audio.return();
        return Response.json({ bytes: Buffer.from(frame.value, 'base64').length, cancelled, calls });
      }} `,
    }),
  );
  try {
    assert.deepEqual(
      await (await mf.dispatchFetch("http://localhost")).json(),
      { bytes: 2400, cancelled: true, calls: 1 },
    );
  } finally {
    await mf.dispose();
  }
});
