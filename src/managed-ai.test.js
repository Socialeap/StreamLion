import test from "node:test";
import assert from "node:assert/strict";
import {
  readAnswerStream,
  createAudioPlayer,
  creditDollars,
  demoAnswer,
} from "./managed-ai.js";

test("answer transport handles arbitrary UTF-8 boundaries and rejects interrupted results", async () => {
  const bytes = new TextEncoder().encode(
    '{"type":"text","delta":"café"}\n{"type":"done","balanceMicros":7}\n',
  );
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
        c.close();
      },
    }),
  );
  const events = [];
  await readAnswerStream(
    response,
    (event) => events.push(event),
    new AbortController().signal,
  );
  assert.equal(events[0].delta, "café");
  assert.equal(events[1].balanceMicros, 7);
  await assert.rejects(
    readAnswerStream(
      new Response('{"type":"text","delta":"partial"}\n'),
      () => {},
      new AbortController().signal,
    ),
    /interrupted/,
  );
  await assert.rejects(
    readAnswerStream(
      new Response(JSON.stringify({ error: "Credits unavailable." }), {
        status: 429,
      }),
      () => {},
      new AbortController().signal,
    ),
    /Credits unavailable/,
  );
});
test("audio context unlocks from the gesture, schedules segments in order and stops all playback", async () => {
  let instance;
  class Context {
    constructor() {
      instance = this;
      this.currentTime = 5;
      this.state = "suspended";
      this.sources = [];
    }
    async resume() {
      this.state = "running";
    }
    async decodeAudioData() {
      return { duration: 2 };
    }
    createBufferSource() {
      const node = {
        connect() {},
        disconnect() {},
        start(time) {
          this.time = time;
        },
        stop() {
          this.stopped = true;
        },
      };
      this.sources.push(node);
      return node;
    }
    async close() {
      this.closed = true;
    }
  }
  const player = createAudioPlayer(Context);
  await player.unlock();
  await player.append("UklGRg==");
  await player.append("UklGRg==");
  assert.equal(instance.sources[1].time - instance.sources[0].time, 2);
  player.stop();
  assert.ok(instance.closed);
  assert.ok(instance.sources.every((s) => s.stopped));
});
test("demo separates the location name from its street address and never calls a provider", async () => {
  const events = [],
    project = { title: "Synthetic venue", address: "123 Example Street" };
  const answer = await demoAnswer(
    project,
    "What is the name of the location?",
    (event) => events.push(event),
    new AbortController().signal,
  );
  assert.match(answer, /Synthetic venue/);
  assert.doesNotMatch(answer, /123 Example Street/);
  assert.equal(events[0].priceMicros, 0);
  assert.match(events[0].source, /simulated/);
  assert.equal(creditDollars(12500), "$0.0125");
});
