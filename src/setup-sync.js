// Keeps the setup assistant's answers with the provider's Google account, so
// they follow the provider to every device and browser. This device's copy
// stays the working copy; the newest saved copy wins.
import { fetchRead } from "./network.js";
import { newerSetup, readSetup, writeSetup } from "./setup-assistant.js";

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
// Bring this device and the account to the newest setup. Returns the setup
// now on this device (or null), or undefined when the account is unavailable.
export async function syncSetup(
  api = setupAPI,
  storage = globalThis.localStorage,
) {
  const remote = await api();
  if (!remote.available) return undefined;
  const local = readSetup(storage);
  const newest = newerSetup(local, remote.state);
  if (newest && newest !== local) writeSetup(newest, storage);
  if (newest && newest !== remote.state) await api(newest, remote.subject);
  return newest;
}
