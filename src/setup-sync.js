// Keeps the setup assistant's answers with the provider's Google account, so
// they follow the provider to every device and browser. This device's copy
// stays the working copy; the newest saved copy wins.
import { fetchRead } from "./network.js";
import {
  SETUP_KEY,
  newSetup,
  newerSetup,
  readSetup,
  writeSetup,
} from "./setup-assistant.js";

export async function setupAPI(state, subject) {
  const response = await fetchRead("/api/provider-setup", {
    credentials: "same-origin",
    cache: "no-store",
    ...(state
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-StreamLion-Account": subject,
          },
          body: JSON.stringify({ state }),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Your saved setup is unavailable.");
  return result;
}
// Keep displaced device copies instead of assigning their answers to a different
// signed-in account. Legacy/device-only answers require an explicit UI choice.
const deviceKey = `${SETUP_KEY}:device`;
const accountKey = (subject) =>
  `${SETUP_KEY}:account:${encodeURIComponent(subject)}`;
const stored = (key, storage) =>
  readSetup({ getItem: () => storage.getItem(key) });
export function deviceSetup(storage = globalThis.localStorage) {
  return stored(deviceKey, storage);
}
export function selectSetupAccount(remote, storage = globalThis.localStorage) {
  if (!remote.available || !remote.subject)
    throw new Error("Your setup account could not be checked.");
  const subject = remote.subject;
  const local = readSetup(storage);
  let own = local;
  if (local?.accountSubject !== subject) {
    if (local)
      storage.setItem(
        local.accountSubject ? accountKey(local.accountSubject) : deviceKey,
        JSON.stringify(local),
      );
    own = stored(accountKey(subject), storage);
    if (own?.accountSubject !== subject) own = null;
  }
  // Metadata received from the account is bound to the authenticated response,
  // never to an owner field contained in an uploaded/old device backup.
  const account = remote.state
    ? { ...remote.state, accountSubject: subject }
    : null;
  const newest = newerSetup(own, account);
  const state = newest || { ...newSetup(), accountSubject: subject };
  const bound = { ...state, accountSubject: subject };
  if (!writeSetup(bound, storage))
    throw new Error(
      "This browser could not keep your account setup. Nothing was uploaded.",
    );
  return {
    state: bound,
    push:
      !!own?.done?.length &&
      newest === own &&
      JSON.stringify(own) !== JSON.stringify(account),
    device: !bound.done.length ? deviceSetup(storage) : null,
  };
}
// Bring only this account's device copy and saved account copy up to date.
export async function syncSetup(
  api = setupAPI,
  storage = globalThis.localStorage,
  isCurrent = () => true,
) {
  const remote = await api();
  if (!isCurrent()) return undefined;
  if (!remote.available) {
    return remote.subject
      ? selectSetupAccount({ ...remote, available: true }, storage).state
      : undefined;
  }
  const selected = selectSetupAccount(remote, storage);
  if (selected.push && isCurrent()) await api(selected.state, remote.subject);
  return isCurrent() ? selected.state : undefined;
}

// Serialize snapshots and retain a failed snapshot for an explicit retry. A
// navigation handler awaits flush(); cancel() only stops deferred work when the
// identity/component changes. The device copy remains available for recovery.
export function setupSaveQueue(api, subject, onStatus = () => {}) {
  let pending = null,
    timer = null,
    running = null,
    cancelled = false;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (running) return running;
    if (cancelled || !pending) return Promise.resolve();
    running = (async () => {
      while (pending && !cancelled) {
        const state = pending;
        pending = null;
        try {
          const result = await api(state, subject);
          if (!result?.available || result.subject !== subject)
            throw new Error("Your account save could not be confirmed.");
          if (!cancelled && !pending) onStatus(true);
        } catch (error) {
          if (!pending) pending = state;
          if (!cancelled) onStatus(false);
          throw error;
        }
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };
  return {
    enqueue(state) {
      if (cancelled || state.accountSubject !== subject) return;
      pending = state;
      clearTimeout(timer);
      timer = setTimeout(() => {
        flush().catch(() => {});
      }, 600);
    },
    flush,
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}
