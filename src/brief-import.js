import { fetchRead } from "./network.js";
import { BRIEF_LIMITS, validateBriefResult } from "./brief-import-contract.js";

export const briefPendingKey = (draftKey) => draftKey + ":brief-import-v1";
export function readPendingBrief(draftKey) {
  try {
    const value = JSON.parse(localStorage.getItem(briefPendingKey(draftKey)));
    return value &&
      typeof value.requestId === "string" &&
      typeof value.scope === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export function keepPendingBrief(draftKey, value) {
  localStorage.setItem(briefPendingKey(draftKey), JSON.stringify(value));
}
export function forgetPendingBrief(draftKey) {
  localStorage.removeItem(briefPendingKey(draftKey));
}
export async function briefRequest(route, body, fetcher) {
  const response = await fetchRead(
    "/api/brief-import/" + route,
    {
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      credentials: "same-origin",
      cache: "no-store",
    },
    { ...(fetcher ? { fetcher } : {}) },
  );
  const text = await response.text();
  if (text.length > BRIEF_LIMITS.responseBytes)
    throw new Error(
      "The brief response was too large. Recover the existing brief before trying again.",
    );
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "The connection was interrupted. Recover the existing brief before trying again.",
    );
  }
  if (!response.ok) {
    const error = new Error(data.error || "Brief preparation is unavailable.");
    error.definite = [400, 401, 402, 403, 409, 413, 415, 429].includes(
      response.status,
    );
    throw error;
  }
  if (data.state === "complete")
    data.project = validateBriefResult(JSON.stringify(data.project));
  return data;
}
export function fillEmptyBriefFields(current, proposed) {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      value.trim() ? value : proposed[key] || "",
    ]),
  );
}
