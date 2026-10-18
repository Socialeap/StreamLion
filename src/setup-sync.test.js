import test from "node:test";
import assert from "node:assert/strict";
import { syncSetup } from "./setup-sync.js";
import {
  newSetup,
  answerStep,
  readSetup,
  writeSetup,
  SETUP_KEY,
} from "./setup-assistant.js";
const storage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    data,
  };
};
const answered = (name, subject, time = "2026-10-18T12:00:00.000Z") => ({
  ...answerStep(newSetup(time), "name", name, {}, time),
  ...(subject ? { accountSubject: subject } : {}),
});
test("switching accounts never uploads another account setup and preserves its device copy", async () => {
  const device = storage();
  writeSetup(answered("Avery", "account-a"), device);
  const posts = [];
  let remote = { available: true, subject: "account-b", state: null };
  const api = async (state, subject) => {
    if (state) posts.push([state, subject]);
    return remote;
  };
  const b = await syncSetup(api, device);
  assert.equal(posts.length, 0);
  assert.deepEqual(b?.answers || {}, {});
  assert.notEqual(readSetup(device)?.answers.name, "Avery");
  remote = { available: true, subject: "account-a", state: null };
  await syncSetup(api, device);
  assert.equal(readSetup(device).answers.name, "Avery");
  assert.equal(posts.length, 1);
  assert.equal(posts[0][1], "account-a");
});
test("unowned legacy answers are preserved without uploading into a signed-in account", async () => {
  const device = storage();
  const legacy = answered("Legacy");
  writeSetup(legacy, device);
  const posts = [];
  await syncSetup(async (state) => {
    if (state) posts.push(state);
    return { available: true, subject: "account-b", state: null };
  }, device);
  assert.equal(posts.length, 0);
  assert.notEqual(readSetup(device)?.answers.name, "Legacy");
  assert(
    [...device.data.values()].some(
      (value) => JSON.parse(value)?.answers?.name === "Legacy",
    ),
  );
});
test("another account remote answers win over a newer foreign device copy", async () => {
  const device = storage();
  writeSetup(answered("Foreign", "a", "2026-10-19T00:00:00.000Z"), device);
  const remote = answered("Correct", "b");
  const posts = [];
  await syncSetup(async (state) => {
    if (state) posts.push(state);
    return { available: true, subject: "b", state: remote };
  }, device);
  assert.equal(readSetup(device).answers.name, "Correct");
  assert.equal(posts.length, 0);
});

test("a stale restore cannot replace the newly selected account or start an upload", async () => {
  const device = storage();
  writeSetup(answered("Current", "b"), device);
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const restoring = syncSetup(
    () => response,
    device,
    () => false,
  );
  release({
    available: true,
    subject: "a",
    state: answered("Old request", "a"),
  });
  assert.equal(await restoring, undefined);
  assert.equal(readSetup(device).answers.name, "Current");
});

test("queued saves flush immediately and serialize the newest snapshot behind an in-flight save", async () => {
  const { setupSaveQueue } = await import("./setup-sync.js");
  const posts = [],
    gates = [];
  const queue = setupSaveQueue((state, subject) => {
    posts.push([state, subject]);
    return new Promise((resolve) =>
      gates.push(() => resolve({ available: true, subject })),
    );
  }, "a");
  queue.enqueue(answered("First", "a"));
  const flushing = queue.flush();
  assert.equal(
    posts.length,
    1,
    "navigation flush sends before the debounce expires",
  );
  queue.enqueue(answered("Newest", "a", "2026-10-18T13:00:00.000Z"));
  const alsoFlushing = queue.flush();
  assert.equal(posts.length, 1, "one request in flight");
  gates.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posts.length, 2);
  assert.equal(posts[1][0].answers.name, "Newest");
  gates.shift()();
  await Promise.all([flushing, alsoFlushing]);
  queue.cancel();
});

test("a failed save is kept for explicit retry, and cancellation never sends another account snapshot", async () => {
  const { setupSaveQueue } = await import("./setup-sync.js");
  let attempts = 0;
  const queue = setupSaveQueue(async () => {
    if (++attempts === 1) throw Error("offline");
    return { available: true, subject: "a" };
  }, "a");
  queue.enqueue(answered("Recoverable", "a"));
  await assert.rejects(queue.flush(), /offline/);
  await queue.flush();
  assert.equal(attempts, 2);
  queue.enqueue(answered("Foreign", "b"));
  await queue.flush();
  assert.equal(attempts, 2);
  queue.enqueue(answered("Not sent", "a"));
  queue.cancel();
  await queue.flush();
  assert.equal(attempts, 2);
});

test("unavailable or changed-account save receipts never report success", async () => {
  const { setupSaveQueue } = await import("./setup-sync.js");
  for (const response of [
    { available: false, subject: "a" },
    { available: true, subject: "b" },
  ]) {
    const status = [];
    const queue = setupSaveQueue(
      async () => response,
      "a",
      (ok) => status.push(ok),
    );
    queue.enqueue(answered("Avery", "a"));
    await assert.rejects(queue.flush(), /could not be confirmed/);
    assert.deepEqual(status, [false]);
    queue.cancel();
  }
});

test("a verified new identity is isolated even when account saving is unavailable", async () => {
  const device = storage();
  writeSetup(answered("Foreign", "a"), device);
  const selected = await syncSetup(
    async () => ({ available: false, subject: "b" }),
    device,
  );
  assert.equal(selected.accountSubject, "b");
  assert.equal(readSetup(device).accountSubject, "b");
  assert.notEqual(readSetup(device).answers.name, "Foreign");
});
