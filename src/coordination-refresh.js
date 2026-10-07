// One refresh at a time; no hidden/offline polling. Focus resumes with a full read.
export function startCoordinationRefresh({
  refresh,
  pollMs = () => 15000,
  onError,
  window: win = window,
  document: doc = document,
  navigator: nav = navigator,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let stopped = false,
    timer,
    running = false,
    force = false,
    lastActivity = now();
  const visible = () =>
    doc.visibilityState === "visible" && nav.onLine !== false;
  const activity = () => {
    const timestamp = now();
    const wasIdle = timestamp - lastActivity >= 60000;
    lastActivity = timestamp;
    if (wasIdle && !running && !stopped) {
      cancel(timer);
      arm();
    }
  };
  const arm = () => {
    if (!stopped)
      timer = schedule(
        tick,
        now() - lastActivity < 60000 ? pollMs() : Math.max(60000, pollMs()),
      );
  };
  async function tick() {
    if (stopped || running) return;
    cancel(timer);
    if (visible()) {
      running = true;
      const conditional = !force;
      force = false;
      try {
        await refresh({ conditional });
      } catch (error) {
        if (!stopped) onError(error);
      } finally {
        running = false;
      }
    }
    if (force && visible() && !stopped) return tick();
    arm();
  }
  const resume = () => {
    if (visible()) {
      activity();
      force = true;
      void tick();
    }
  };
  win.addEventListener("focus", resume);
  win.addEventListener("online", resume);
  doc.addEventListener("visibilitychange", resume);
  doc.addEventListener("pointerdown", activity, { passive: true });
  doc.addEventListener("keydown", activity);
  arm();
  return () => {
    stopped = true;
    cancel(timer);
    win.removeEventListener("focus", resume);
    win.removeEventListener("online", resume);
    doc.removeEventListener("visibilitychange", resume);
    doc.removeEventListener("pointerdown", activity);
    doc.removeEventListener("keydown", activity);
  };
}
