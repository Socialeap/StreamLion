let status = "idle";
let apply = () => {};
const listeners = new Set();
export const updateStatus = () => status;
export function subscribeUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setStatus(next) {
  status = next;
  listeners.forEach((listener) => listener());
}
export function offerUpdate(handler) {
  apply = handler;
  if (status !== "applying") setStatus("ready");
}
export const applyUpdate = (canReload = () => true) => apply(canReload);

function waitForActivation(worker, timeoutMs) {
  return new Promise((resolve) => {
    const done = (activated) => {
      clearTimeout(timeout);
      worker.removeEventListener("statechange", check);
      resolve(activated);
    };
    const check = () => {
      if (worker.state === "activated") done(true);
      else if (worker.state === "redundant") done(false);
    };
    const timeout = setTimeout(() => done(false), timeoutMs);
    worker.addEventListener("statechange", check);
    try {
      if (worker.state === "installed")
        worker.postMessage({ type: "SKIP_WAITING" });
      check();
    } catch {
      done(false);
    }
  });
}

export function observeServiceWorkerUpdates(
  registration,
  { reload = () => window.location.reload(), timeoutMs = 10000 } = {},
) {
  let offered;
  function offer(worker) {
    if (offered === worker) return;
    offered = worker;
    offerUpdate(async (canReload) => {
      if (status === "applying" || !canReload()) return;
      setStatus("applying");
      const activated = await waitForActivation(worker, timeoutMs);
      // Another release can supersede this worker while activation is pending.
      if (offered !== worker) {
        setStatus("ready");
      } else if (!activated) {
        setStatus("retry");
      } else if (canReload()) {
        reload();
      } else {
        setStatus("ready");
      }
    });
  }

  function watchInstalling() {
    const incoming = registration.installing;
    if (!incoming || !registration.active) return;
    const check = () => {
      if (["installed", "activating", "activated"].includes(incoming.state))
        offer(incoming);
      if (["activated", "redundant"].includes(incoming.state))
        incoming.removeEventListener("statechange", check);
    };
    incoming.addEventListener("statechange", check);
    check();
  }

  registration.addEventListener("updatefound", watchInstalling);
  if (registration.waiting) offer(registration.waiting);
  watchInstalling();
}

// Workbox registers the worker. StreamLion handles reload itself, since a tab
// opened before installation may never receive a controllerchange event.
export function registerAppUpdates(registerSW, onOfflineReady) {
  registerSW({
    onRegisteredSW(_url, registration) {
      if (registration) observeServiceWorkerUpdates(registration);
    },
    onNeedReload() {},
    onOfflineReady,
  });
}
