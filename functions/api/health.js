import { googleConfigurationReady } from "../../server/google-auth.js";
import { paymentMode, licenseRequired } from "../../server/purchase-access.js";

// Coalesce probes and cache for 30 seconds per binding/configuration to bound
// public monitoring reads. Never call Google or Stripe from this endpoint.
const probes = new WeakMap();
async function databaseReady(env) {
  const database = env.GOOGLE_SESSIONS;
  const extension = env.ENABLE_CHATGPT_EXTENSION === "true";
  const purchases = paymentMode(env) !== "disabled" || licenseRequired(env);
  const key = `${extension}:${purchases}`;
  const cached = probes.get(database);
  if (cached?.key === key && cached.expires > Date.now()) return cached.promise;
  const record = { key, expires: Date.now() + 30000 };
  record.promise = (async () => {
    let timer;
    try {
      const checks = [
        "(SELECT COUNT(*) FROM streamlion_auth_schema_v1 WHERE version=1)=1",
        "(SELECT COUNT(*) FROM streamlion_google_folder_schema_v1 WHERE version=1)=1",
        "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='streamlion_google_request_limits_v1')",
      ];
      if (extension)
        checks.push(
          "(SELECT COUNT(*) FROM streamlion_extension_schema_v1 WHERE version=1)=1",
        );
      if (purchases)
        checks.push(
          "(SELECT COUNT(*) FROM streamlion_purchase_schema_v2 WHERE version=2)=1",
        );
      const value = await Promise.race([
        database.prepare(`SELECT ${checks.join(" AND ")} AS ready`).first(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), 1500);
        }),
      ]);
      return value?.ready === 1;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  probes.set(database, record);
  return record.promise;
}

export async function onRequest({ request, env }) {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  const persistent = env.ENABLE_PERSISTENT_GOOGLE === "true";
  const configured = persistent
    ? googleConfigurationReady(env)
    : Boolean(env.VITE_GOOGLE_CLIENT_ID);
  const database = !configured
    ? "not-checked"
    : persistent
      ? (await databaseReady(env))
        ? "ready"
        : "unavailable"
      : "not-required";
  const ready = configured && database !== "unavailable";
  const value = {
    service: "streamlion",
    schema: 2,
    status: ready ? "ready" : configured ? "degraded" : "setup-required",
    googleMode: persistent ? "persistent" : "browser-session",
    checks: { configuration: configured ? "ready" : "missing", database },
    databaseProbeCacheSeconds: 30,
    upstreamsChecked: false,
  };
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(value),
    {
      status: ready ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
