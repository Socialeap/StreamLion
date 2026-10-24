// Content-free, bounded foreground signals. Never used for billing or authorization.
export function startAccountActivity() {
  if (typeof window === "undefined" || typeof document === "undefined")
    return () => {};
  const key = "streamlion:foreground-activity:v1";
  let running = false,
    last = 0;
  const read = () => {
    try {
      const x = JSON.parse(localStorage.getItem(key) || "{}");
      return typeof x.subject === "string" && Array.isArray(x.events)
        ? {
            subject: x.subject,
            events: x.events
              .filter(Number.isSafeInteger)
              .filter((t) => t > Date.now() - 7 * 86400000)
              .slice(-7),
          }
        : { subject: "", events: [] };
    } catch {
      return { subject: "", events: [] };
    }
  };
  const save = (x) => {
    try {
      localStorage.setItem(key, JSON.stringify(x));
    } catch {
      /* Optional metadata never blocks field work. */
    }
  };
  async function foreground() {
    if (
      running ||
      document.visibilityState === "hidden" ||
      Date.now() - last < 60000
    )
      return;
    last = Date.now();
    running = true;
    try {
      let queue = read();
      if (navigator.onLine === false) {
        if (queue.subject)
          save({ ...queue, events: [...queue.events, Date.now()].slice(-7) });
        return;
      }
      const r = await fetch("/api/google/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) return;
      const s = await r.json();
      if (!s.connected || !s.subject) {
        save({ subject: "", events: [] });
        return;
      }
      if (queue.subject !== s.subject)
        queue = { subject: s.subject, events: [] };
      queue.events = [...queue.events, Date.now()].slice(-7);
      save(queue);
      while (queue.events.length) {
        const at = queue.events[0];
        const sent = await fetch("/api/account-activity", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-StreamLion-Account": s.subject,
          },
          body: JSON.stringify({ subject: s.subject, occurredAt: at }),
        });
        if (sent.status === 401 || sent.status === 403) {
          save({ subject: "", events: [] });
          break;
        }
        if (!sent.ok) break;
        queue.events.shift();
        save(queue);
      }
    } catch {
      /* Queue remains bounded for the next foreground visit. */
    } finally {
      running = false;
    }
  }
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("online", foreground);
  void foreground();
  return () => {
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("online", foreground);
  };
}
