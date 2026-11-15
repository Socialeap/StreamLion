import assert from "node:assert/strict";
import test from "node:test";
let nextTab = 0;
async function fixture() {
  const updates = await import("./updates.js?tab=" + nextTab++);
  const worker = Object.assign(new EventTarget(), {
    state: "installed",
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
    transition(next) {
      this.state = next;
      this.dispatchEvent(new Event("statechange"));
    },
  });
  const registration = Object.assign(new EventTarget(), {
    active: {},
    waiting: worker,
    installing: null,
  });
  let reloads = 0;
  updates.observeServiceWorkerUpdates(registration, {
    reload: () => reloads++,
    timeoutMs: 20,
  });
  return { updates, worker, registration, reloads: () => reloads };
}

test("an offered worker already active at click still reloads the requesting page", async () => {
  const f = await fixture();
  const { updates } = f;
  f.registration.active = f.worker;
  f.registration.waiting = null;
  f.worker.transition("activated");
  assert.equal(f.reloads(), 0);
  await updates.applyUpdate(() => true);
  assert.equal(f.reloads(), 1);
  assert.deepEqual(f.worker.messages, []);
});

test("a waiting worker must activate and the editor must still be safe before reload", async () => {
  const f = await fixture();
  const { updates } = f;
  let safe = true;
  const pending = updates.applyUpdate(() => safe);
  assert.deepEqual(f.worker.messages, [{ type: "SKIP_WAITING" }]);
  assert.equal(f.reloads(), 0);
  assert.equal(updates.updateStatus(), "applying");
  safe = false;
  f.registration.active = f.worker;
  f.registration.waiting = null;
  f.worker.transition("activated");
  await pending;
  assert.equal(f.reloads(), 0);
  assert.equal(updates.updateStatus(), "ready");
  safe = true;
  await updates.applyUpdate(() => safe);
  assert.equal(f.reloads(), 1);
});

test("a worker that never activates leaves a visible retry state without reloading", async () => {
  const f = await fixture();
  const { updates } = f;
  await updates.applyUpdate(() => true);
  assert.equal(f.reloads(), 0);
  assert.equal(updates.updateStatus(), "retry");
  f.registration.active = f.worker;
  f.registration.waiting = null;
  f.worker.transition("activated");
  assert.equal(f.reloads(), 0);
  await updates.applyUpdate(() => true);
  assert.equal(f.reloads(), 1);
});
