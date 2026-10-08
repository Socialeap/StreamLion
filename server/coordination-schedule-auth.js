const PATH = "/api/coordination-maintenance";
const encode = (bytes) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const decode = (hex) =>
  Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
const canonical = (url, stamp, nonce, raw) =>
  new TextEncoder().encode(
    `streamlion-coordination-schedule-v1\nPOST\n${url}\n${stamp}\n${nonce}\n${raw}`,
  );
async function key(value) {
  if (!/^[a-f0-9]{64}$/.test(value || ""))
    throw new Error("scheduler_configuration");
  return crypto.subtle.importKey(
    "raw",
    decode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export function scheduleURL(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new Error("scheduler_configuration");
  return origin + PATH;
}
export async function createMaintenanceRequest(env, now = Date.now()) {
  const url = scheduleURL(env.COORDINATION_SCHEDULER_ORIGIN);
  if (!["test", "live"].includes(env.STREAMLION_PAYMENTS_MODE))
    throw new Error("scheduler_configuration");
  const stamp = String(Math.floor(now / 1000));
  const nonce = encode(crypto.getRandomValues(new Uint8Array(16)));
  const raw = JSON.stringify({ mode: env.STREAMLION_PAYMENTS_MODE });
  const signature = encode(
    await crypto.subtle.sign(
      "HMAC",
      await key(env.COORDINATION_SCHEDULER_KEY),
      canonical(url, stamp, nonce, raw),
    ),
  );
  return new Request(url, {
    method: "POST",
    body: raw,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "X-StreamLion-Schedule-Time": stamp,
      "X-StreamLion-Schedule-Nonce": nonce,
      "X-StreamLion-Schedule-Signature": signature,
    },
    signal: AbortSignal.timeout(55000),
  });
}
export async function verifyMaintenanceRequest(request, env, raw, now) {
  const url = scheduleURL(env.GOOGLE_AUTH_ORIGIN);
  const signingKey = await key(env.COORDINATION_SCHEDULER_KEY);
  const stamp = request.headers.get("X-StreamLion-Schedule-Time");
  const nonce = request.headers.get("X-StreamLion-Schedule-Nonce");
  const signature = request.headers.get("X-StreamLion-Schedule-Signature");
  if (
    request.method !== "POST" ||
    request.url !== url ||
    !/^\d{10}$/.test(stamp || "") ||
    Math.abs(now / 1000 - Number(stamp)) > 120 ||
    !/^[a-f0-9]{32}$/.test(nonce || "") ||
    !/^[a-f0-9]{64}$/.test(signature || "")
  )
    return null;
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      signingKey,
      decode(signature),
      canonical(url, stamp, nonce, raw),
    ))
  )
    return null;
  const body = JSON.parse(raw);
  if (
    Object.keys(body).length !== 1 ||
    !["test", "live"].includes(body.mode) ||
    body.mode !== env.STREAMLION_PAYMENTS_MODE
  )
    return null;
  return { nonce, mode: body.mode };
}
