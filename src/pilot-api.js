export async function pilotRequest(route, { account, ...options } = {}) {
  const r = await fetch("/api/free-pilot/" + route, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(account ? { "X-StreamLion-Account": account } : {}),
      ...options.headers,
    },
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Pilot could not be checked.");
  return result;
}
export function pilotReceipt(status, now = Date.now()) {
  return status?.enabled === true &&
    status.active === true &&
    Number.isSafeInteger(status.startsAt) &&
    Number.isSafeInteger(status.endsAt) &&
    status.startsAt <= now &&
    now < status.endsAt
    ? { expires: status.endsAt, pilot: true }
    : null;
}
export function pilotDate(timestamp) {
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: "UTC",
      }).format(timestamp)
    : "Not set";
}
