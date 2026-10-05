const base = new URL(
  process.argv[2] || "https://streamlion.transcendencemedia.com",
);
const expected = process.argv[3];
if (base.protocol !== "https:" && base.hostname !== "127.0.0.1")
  throw new Error("Use the exact HTTPS release address.");
const checks = [];
async function read(path) {
  const response = await fetch(new URL(path, base), {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  checks.push({ path, http: response.status, passed: response.ok });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return { response, value: await response.json() };
}
try {
  const release = await read("/release.json");
  if (
    !/^[a-f0-9]{40}$/.test(release.value.revision) ||
    (expected && release.value.revision !== expected)
  )
    throw new Error(
      "Deployed revision is missing or does not match the approved SHA.",
    );
  const health = await read("/api/health");
  if (
    health.value.status !== "ready" ||
    health.value.googleMode !== "persistent" ||
    health.value.schema !== 2 ||
    health.value.checks?.database !== "ready" ||
    health.value.upstreamsChecked !== false ||
    !health.response.headers.get("X-StreamLion-Request-ID")
  )
    throw new Error(
      "Persistent Google database readiness or diagnostic headers failed.",
    );
  const session = await read("/api/google/session");
  if (
    session.value.enabled !== true ||
    session.value.connected !== false ||
    !session.response.headers.get("Cache-Control")?.includes("no-store") ||
    /accessToken|refreshToken|credentials/.test(JSON.stringify(session.value))
  )
    throw new Error("Unauthenticated session health failed.");
  const config = await read("/api/google-config");
  if (
    !config.value.clientId?.endsWith(".apps.googleusercontent.com") ||
    !config.value.apiKey ||
    !/^\d+$/.test(config.value.appId) ||
    config.value.persistentEnabled !== true
  )
    throw new Error("Public Google configuration is incomplete.");
  console.log(
    JSON.stringify(
      { passed: true, revision: release.value.revision, checks },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({ passed: false, error: error.message, checks }, null, 2),
  );
  process.exitCode = 1;
}
