export async function purchaseRequest(path, { account, ...options } = {}) {
  const response = await fetch("/api/purchase/" + path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(account ? { "X-StreamLion-Account": account } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "Purchase settings are unavailable. Please try again.",
    );
  if (
    ["config", "status"].includes(path) &&
    (typeof result.enabled !== "boolean" ||
      typeof result.required !== "boolean" ||
      (path === "status" && typeof result.purchased !== "boolean"))
  )
    throw new Error(
      "Purchase settings could not be verified. Please try again.",
    );
  return result;
}
