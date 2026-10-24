// Public offers are rendered only from a fresh, validated server policy.
const instances = new WeakMap();

function offerFor(config) {
  if (config?.enabled !== true) return null;
  if (!["available", "full", "closed"].includes(config.availability))
    return null;
  if (config.availability === "available" && config.applicationsOpen === true) {
    if (![7, 14].includes(config.durationDays)) return null;
    if (!["instant", "manual"].includes(config.admissionMode)) return null;
    const instant = config.admissionMode === "instant";
    if (!instant && config.interestOpen !== true) return null;
    return {
      cta: instant ? "Start free pilot" : "Register interest",
      status: instant
        ? `Start your free ${config.durationDays}-day Core pilot. Sign in with Google, confirm the terms and activate your access.`
        : `Register interest in the ${config.durationDays}-day Core pilot — manual approval required before access.`,
      flow: instant
        ? "Sign in with Google → confirm the terms → activate. Your pilot starts at activation, and your Google files remain yours."
        : "Sign in with Google → register interest → wait for approval. Joining the interest list does not activate or reserve access.",
      full: false,
    };
  }
  if (config.interestOpen !== true) return null;
  const full = config.availability === "full";
  return {
    full,
    cta: "Join interest list",
    status: full
      ? "More pilot places are planned. Join the interest list for news of the next opening."
      : "Pilot access is currently closed. Join the interest list for news of future pilot openings.",
    flow: "Joining the interest list does not activate access or reserve a place. Future admission requires a confirmed opening.",
  };
}

function createCard(document, offer) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const section = element("section", "landing-pilot shell");
  section.id = "landing-pilot";
  section.setAttribute("aria-labelledby", "landing-pilot-title");
  const card = element("div", "pilot-offer");
  const eyebrow = element("p", "pilot-eyebrow", "StreamLion · Free Core Pilot");
  const title = element("h2", "", "Take StreamLion on a real capture job.");
  title.id = "landing-pilot-title";
  card.append(eyebrow);
  if (offer.full)
    card.append(
      element("p", "pilot-update", "Update: this pilot group is full."),
    );
  card.append(
    title,
    element(
      "p",
      "pilot-description",
      "Prepare the visit. Keep field records together. Create a clear handover from your Google workspace.",
    ),
  );
  const steps = element("ul", "pilot-steps");
  steps.setAttribute("aria-label", "What you can test");
  for (const label of ["Prepare", "Capture notes", "Handover"])
    steps.append(element("li", "", label));
  card.append(steps, element("p", "pilot-state", offer.status));
  const actions = element("div", "pilot-actions");
  const link = element("a", "pilot-primary", offer.cta);
  link.href = "/pilot/";
  const button = element("button", "pilot-secondary", "What’s included?");
  button.type = "button";
  button.setAttribute("aria-controls", "landing-pilot-details");
  button.setAttribute("aria-expanded", "false");
  const details = element("div", "pilot-details");
  details.id = "landing-pilot-details";
  details.hidden = true;
  details.append(
    element(
      "p",
      "",
      "Manual project preparation, field notes, measurements, Google save and exports. Paid AI, hosted voice and client-portal automation are excluded.",
    ),
    element("p", "", offer.flow),
  );
  button.addEventListener("click", () => {
    details.hidden = !details.hidden;
    button.setAttribute("aria-expanded", String(!details.hidden));
  });
  actions.append(link, button);
  card.append(
    actions,
    element(
      "p",
      "pilot-trust",
      "No card · No purchase obligation · No automatic charge",
    ),
    details,
  );
  section.append(card);
  return section;
}

export function initializeLandingPilot(document, window, options = {}) {
  if (instances.has(document)) return instances.get(document);
  const fetchImpl = options.fetchImpl || window.fetch.bind(window);
  const intervalMs = Math.max(
    30000,
    Math.min(300000, options.intervalMs || 60000),
  );
  let disposed = false;
  let pending;
  let requestController;
  let signature;
  let card;
  function clear() {
    card?.remove();
    card = undefined;
    signature = undefined;
  }
  function refresh() {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    // An old activation link cannot remain actionable during revalidation.
    const priorLink = card?.querySelector("a");
    priorLink?.removeAttribute("href");
    priorLink?.setAttribute("aria-disabled", "true");
    requestController = new AbortController();
    const timeout = window.setTimeout(() => requestController?.abort(), 8000);
    pending = (async () => {
      try {
        const response = await Promise.resolve().then(() =>
          fetchImpl("/api/free-pilot/config", {
            credentials: "omit",
            cache: "no-store",
            signal: requestController.signal,
          }),
        );
        if (!response.ok) throw new Error("Unavailable");
        const offer = offerFor(await response.json());
        if (disposed) return;
        if (!offer) return clear();
        const nextSignature = JSON.stringify(offer);
        if (signature !== nextSignature) {
          const next = createCard(document, offer);
          if (card) card.replaceWith(next);
          else {
            const hero = document.querySelector("main .hero");
            if (!hero) return;
            hero.after(next);
          }
          card = next;
          signature = nextSignature;
        }
        const link = card.querySelector("a");
        link.setAttribute("href", "/pilot/");
        link.removeAttribute("aria-disabled");
      } catch {
        if (!disposed) clear();
      } finally {
        window.clearTimeout(timeout);
        pending = undefined;
      }
    })();
    return pending;
  }
  const onFocus = () => {
    void refresh();
  };
  const interval = window.setInterval(() => {
    if (document.visibilityState !== "hidden") void refresh();
  }, intervalMs);
  function dispose() {
    disposed = true;
    requestController?.abort();
    window.clearInterval(interval);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    clear();
  }
  const onPageHide = (event) => {
    if (!event.persisted) dispose();
  };
  const onPageShow = (event) => {
    if (event.persisted) void refresh();
  };
  const controller = { refresh, dispose, ready: undefined };
  instances.set(document, controller);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  controller.ready = refresh();
  return controller;
}
