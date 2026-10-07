import React, { useEffect, useState } from "react";

export function pushAvailability() {
  const appleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (
    appleMobile &&
    !navigator.standalone &&
    !window.matchMedia?.("(display-mode: standalone)").matches
  )
    return "install";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}
const fromBase64 = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const endpointID = async (value) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};
export default function NotificationSettings({ role, subject, api }) {
  const [config, setConfig] = useState(null),
    [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const availability = pushAvailability();
  useEffect(() => {
    if (availability !== "ready") {
      setConfig({ enabled: false });
      return;
    }
    let cancelled = false;
    (async () => {
      const settings = await api(role + "/notifications");
      const worker = await navigator.serviceWorker?.getRegistration("/");
      const subscription = await worker?.pushManager?.getSubscription();
      const id = subscription && (await endpointID(subscription.endpoint));
      if (!cancelled) {
        setConfig(settings);
        setActive(Boolean(id && settings.devices?.some((d) => d.id === id)));
      }
    })().catch(() => {
      if (!cancelled) setConfig({ enabled: false });
    });
    return () => {
      cancelled = true;
    };
  }, [role, subject, api, availability]);
  async function toggle() {
    setBusy(true);
    setMessage("");
    let fresh = null;
    try {
      // Request permission directly from the tap, before asynchronous work.
      if (
        !active &&
        Notification.permission !== "granted" &&
        (await Notification.requestPermission()) !== "granted"
      ) {
        setMessage(
          "Notifications were not enabled. Your project and email access still work.",
        );
        return;
      }
      const worker = await navigator.serviceWorker.getRegistration("/");
      if (!worker?.active)
        throw new Error(
          "Open the installed StreamLion app and try again after it updates.",
        );
      if (!active)
        await new Promise((resolve, reject) => {
          const channel = new MessageChannel();
          const timeout = setTimeout(() => {
            channel.port1.close();
            reject(
              new Error("Update StreamLion before enabling device alerts."),
            );
          }, 2000);
          channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            channel.port1.close();
            if (event.data?.notifications === 1) resolve();
            else
              reject(
                new Error("Update StreamLion before enabling device alerts."),
              );
          };
          worker.active.postMessage(
            { type: "streamlion-notification-capability" },
            [channel.port2],
          );
        });
      let subscription = await worker.pushManager.getSubscription();
      if (active) {
        if (subscription) {
          await api(
            role + "/notifications",
            { action: "unsubscribe", endpoint: subscription.endpoint },
            subject,
          );
          await subscription.unsubscribe();
        }
        setActive(false);
        setMessage("Notifications are off on this device.");
      } else {
        if (!subscription) {
          subscription = await worker.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: fromBase64(config.publicKey),
          });
          fresh = subscription;
        }
        await api(
          role + "/notifications",
          { action: "subscribe", subscription: subscription.toJSON() },
          subject,
        );
        setActive(true);
        setMessage("Project alerts are enabled on this device.");
      }
    } catch (error) {
      if (fresh) await fresh.unsubscribe().catch(() => {});
      setMessage(
        error.message || "Notifications could not be changed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="coord-card coord-notification-settings">
      <summary>
        Project notifications{active ? " · enabled on this device" : ""}
      </summary>
      <p>
        Optional alerts link back to your current project. When enabled, routine
        updates prefer device alerts; invitations and important notices still
        arrive by email.
      </p>
      {availability === "install" && (
        <p>
          On iPhone or iPad, use Share → Add to Home Screen, then open
          StreamLion from its icon to enable alerts.
        </p>
      )}
      {availability === "unsupported" && (
        <p>
          Push alerts are unavailable in this browser. Your project updates
          remain available here and by email.
        </p>
      )}
      {availability === "denied" && (
        <p>
          Allow notifications in your browser or device settings to enable
          project alerts.
        </p>
      )}
      {availability === "ready" && config?.enabled && (
        <button type="button" disabled={busy} onClick={toggle}>
          {active ? "Turn off device alerts" : "Enable device alerts"}
        </button>
      )}
      {availability === "ready" && config && !config.enabled && (
        <p>
          Push alerts are awaiting activation. You can review updates in the
          project portal.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p className="coord-small">
        An alert being sent does not confirm that you reviewed or approved a
        change. Confirm important updates inside the project.
      </p>
    </details>
  );
}
