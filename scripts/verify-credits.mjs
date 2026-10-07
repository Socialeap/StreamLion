const [origin, expectedMode = "test"] = process.argv.slice(2);
if (!origin || !["test", "live"].includes(expectedMode))
  throw new Error(
    "Usage: node scripts/verify-credits.mjs HTTPS_ORIGIN test|live",
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
  read("/api/credits/config"),
  read("/api/credits/status"),
  read("/release.json"),
]);
if (
  !config.enabled ||
  config.mode !== expectedMode ||
  config.markupPercent !== 30 ||
  JSON.stringify(config.packs) !==
    JSON.stringify([
      { id: "small", amount: 1000, creditsMicros: 10000000 },
      { id: "medium", amount: 2500, creditsMicros: 25000000 },
      { id: "large", amount: 5000, creditsMicros: 50000000 },
    ])
)
  throw new Error("Credit configuration mismatch.");
if (
  status.mode !== expectedMode ||
  status.connected ||
  status.purchased ||
  status.balanceMicros != null
)
  throw new Error("Unauthenticated credit status is incorrect.");
if (
  /sk_(test|live)|rk_(test|live)|whsec_|access_token|refresh_token/.test(
    JSON.stringify({ config, status }),
  )
)
  throw new Error("Unexpected authorization material.");
console.log(
  JSON.stringify(
    {
      service: "streamlion",
      revision: release.revision,
      mode: config.mode,
      markupPercent: 30,
      packs: config.packs,
      unauthenticatedAccess: false,
      check: "PASS",
    },
    null,
    2,
  ),
);
