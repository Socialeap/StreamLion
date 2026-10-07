import test from "node:test";
import assert from "node:assert/strict";
import { startCoordinationRefresh } from "./coordination-refresh.js";
function fixture(refresh) {
  const win = new EventTarget(),
    doc = new EventTarget(),
    nav = { onLine: true };
  doc.visibilityState = "visible";
  let time = 0,
    id = 0;
  const timers = new Map();
  const stop = startCoordinationRefresh({
    refresh,
    window: win,
    document: doc,
    navigator: nav,
    now: () => time,
    onError: (e) => {
      throw e;
    },
    schedule: (fn, delay) => {
      timers.set(++id, { fn, delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
  });
  return {
    win,
    doc,
    nav,
    timers,
    stop,
    setTime: (t) => {
      time = t;
    },
    async tick() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      await timer.fn();
    },
  };
}
test("refresh pauses hidden/offline, backs off idle, resumes fresh and removes listeners", async () => {
  const calls = [],
    f = fixture(async (opts) => {
      calls.push(opts);
    });
  await f.tick();
  assert.deepEqual(calls, [{ conditional: true }]);
  f.doc.visibilityState = "hidden";
  await f.tick();
  f.doc.visibilityState = "visible";
  f.nav.onLine = false;
  await f.tick();
  assert.equal(calls.length, 1);
  f.nav.onLine = true;
  f.setTime(61000);
  await f.tick();
  assert.equal([...f.timers.values()][0].delay, 60000);
  f.win.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.at(-1).conditional, false);
  f.stop();
  f.win.dispatchEvent(new Event("focus"));
  assert.equal(f.timers.size, 0);
  assert.equal(calls.length, 3);
});
test("focus during an in-flight poll schedules one subsequent full refresh", async () => {
  const calls = [];
  let release;
  const f = fixture(async (opts) => {
    calls.push(opts);
    if (calls.length === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
  });
  const pending = f.tick();
  f.win.dispatchEvent(new Event("focus"));
  f.win.dispatchEvent(new Event("focus"));
  assert.equal(calls.length, 1);
  release();
  await pending;
  assert.deepEqual(calls, [{ conditional: true }, { conditional: false }]);
  assert.equal(f.timers.size, 1);
  f.stop();
});
for (const event of ["pointerdown", "keydown"]) {
  test(`${event} resumes active cadence without postponing it on subsequent activity`, async () => {
    const calls = [],
      f = fixture(async (opts) => {
        calls.push(opts);
      });
    f.setTime(61000);
    await f.tick();
    const idleTimer = f.timers.keys().next().value;
    assert.equal(f.timers.get(idleTimer).delay, 60000);
    f.setTime(61001);
    f.doc.dispatchEvent(new Event(event));
    assert.equal(f.timers.has(idleTimer), false);
    assert.equal(f.timers.size, 1);
    const activeTimer = f.timers.keys().next().value;
    assert.equal(f.timers.get(activeTimer).delay, 15000);
    f.setTime(62000);
    f.doc.dispatchEvent(new Event(event));
    assert.equal(f.timers.keys().next().value, activeTimer);
    assert.equal(calls.length, 1);
    await f.tick();
    assert.equal(calls.length, 2);
    assert.equal(f.timers.size, 1);
    f.stop();
    f.doc.dispatchEvent(new Event(event));
    assert.equal(f.timers.size, 0);
  });
}
test("activity during an idle refresh does not arm an overlapping timer", async () => {
  let release;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.setTime(61000);
  const pending = f.tick();
  f.doc.dispatchEvent(new Event("keydown"));
  assert.equal(f.timers.size, 0);
  release();
  await pending;
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 15000);
  f.stop();
});
