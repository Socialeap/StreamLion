import { getSession } from "./google-auth.js";

// This gate controls new checkout and pending checkout URL reuse only.
// Never apply it to confirmation, existing entitlement or signed webhooks.
export function checkoutAccess(env, identity = null) {
  const configured = env.STREAMLION_CHECKOUT_MODE;
  const mode =
    configured === undefined
      ? env.STREAMLION_PAYMENTS_MODE === "test"
        ? "open"
        : "paused"
      : configured;
  if (mode === "open") return { mode, allowed: true };
  if (mode !== "owner_qa") return { mode: "paused", allowed: false };
  try {
    const raw = env.STREAMLION_CHECKOUT_QA_SUBJECTS;
    if (typeof raw !== "string" || raw.length > 4096) throw new Error();
    const subjects = JSON.parse(raw);
    if (
      !Array.isArray(subjects) ||
      subjects.length < 1 ||
      subjects.length > 10 ||
      subjects.some(
        (subject) =>
          typeof subject !== "string" ||
          !/^[A-Za-z0-9_-]{1,255}$/.test(subject),
      )
    )
      throw new Error();
    return {
      mode,
      allowed: Boolean(identity && subjects.includes(identity.google_subject)),
    };
  } catch {
    return { mode, allowed: false };
  }
}

// Catalog caching never caches authorization. Resolve QA access per request.
export async function checkoutQuoteAccess(request, env) {
  const access = checkoutAccess(env);
  return access.mode === "owner_qa"
    ? checkoutAccess(env, await getSession(request, env))
    : access;
}

export const CHECKOUT_PAUSED = {
  code: "checkout_paused",
  error:
    "New purchases are paused. You can still restore or confirm an existing payment.",
};
