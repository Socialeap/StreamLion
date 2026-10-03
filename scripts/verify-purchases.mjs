const [origin, expectedMode = "test"] = process.argv.slice(2);
if (!origin || !["test", "live"].includes(expectedMode))
  throw new Error(
    "Usage: node scripts/verify-purchases.mjs HTTPS_ORIGIN test|live",
  );
const url = new URL(origin);
if (url.protocol !== "https:" || url.origin !== origin)
  throw new Error("Use the exact HTTPS origin without a trailing slash.");
const read = async (path) => {
  const response = await fetch(origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  if (
    !response.ok ||
    !/no-store/.test(response.headers.get("cache-control") || "")
  )
    throw new Error(path + " is unavailable or cacheable.");
  return response.json();
};
const [config, status, release] = await Promise.all([
  read("/api/purchase/config"),
  read("/api/purchase/status"),
  read("/release.json"),
]);
if (
  !config.enabled ||
  config.mode !== expectedMode ||
  !Number.isSafeInteger(config.amount) ||
  config.amount <= 0 ||
  config.currency !== "usd" ||
  config.refundDays !== 7 ||
  config.launchCapacity !== 200
)
  throw new Error("Purchase configuration mismatch.");
if (status.mode !== expectedMode || status.connected || status.purchased)
  throw new Error("Unauthenticated purchase status is incorrect.");
if (
  JSON.stringify({ config, status }).match(
    /sk_(test|live)|rk_(test|live)|whsec_|access_token|refresh_token/,
  )
)
  throw new Error("Unexpected authorization material.");
console.log(
  JSON.stringify(
    {
      service: "streamlion",
      revision: release.revision,
      mode: config.mode,
      licenseRequired: config.required,
      amount: config.amount,
      currency: config.currency,
      refundDays: config.refundDays,
      unauthenticatedAccess: false,
      check: "PASS",
    },
    null,
    2,
  ),
);
