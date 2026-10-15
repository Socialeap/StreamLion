let state = { available: false, installed: false, busy: false, message: "" };
let deferred = null,
  listening = false;
const listeners = new Set();
const update = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
export const installationState = () => state;
export const subscribeInstallation = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function startInstallListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const display = window.matchMedia?.("(display-mode: standalone)");
  const installed = () =>
    Boolean(display?.matches || window.navigator.standalone);
  update({ installed: installed() });
  display?.addEventListener?.("change", () =>
    update({ installed: installed() }),
  );
  window.addEventListener("beforeinstallprompt", (event) => {
    if (typeof event.prompt !== "function" || state.installed) return;
    event.preventDefault();
    deferred = event;
    update({ available: true, message: "" });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    update({ installed: true, available: false, busy: false, message: "" });
  });
}
export async function requestInstallation() {
  if (!deferred || state.busy || state.installed) return;
  const event = deferred;
  deferred = null;
  update({ available: false, busy: true, message: "" });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    update({
      message:
        choice?.outcome === "accepted"
          ? "Installation requested. Follow your browser’s instructions."
          : "Installation dismissed. You can keep using StreamLion in your browser.",
    });
  } catch {
    update({
      message:
        "Installation could not start. Use your browser’s install menu if available.",
    });
  } finally {
    update({ busy: false });
  }
}
