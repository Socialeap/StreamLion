import { boundedText } from "./request-body.js";
import { hash } from "./google-auth.js";
import { coordinationReady } from "./client-coordination.js";
import { maintainCoordination } from "./coordination-maintenance.js";
import { verifyMaintenanceRequest } from "./coordination-schedule-auth.js";

const reply = (status, value) =>
  new Response(value ? JSON.stringify(value) : null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
export async function handleScheduledCoordination(
  { request, env },
  {
    now = Date.now(),
    ready = coordinationReady,
    maintain = maintainCoordination,
  } = {},
) {
  if (request.method !== "POST") return reply(405);
  if (!/^[a-f0-9]{64}$/.test(env.COORDINATION_SCHEDULER_KEY || ""))
    return reply(503);
  let grant;
  try {
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply(401);
    grant = await verifyMaintenanceRequest(
      request,
      env,
      await boundedText(request, 128),
      now,
    );
  } catch {
    return reply(401);
  }
  if (!grant) return reply(401);
  try {
    if (!(await ready(env))) return reply(503);
    // Existing hourly-maintained rate metadata retains nonces for at least 24h,
    // longer than the two-minute signature window. The atomic insert rejects
    // concurrent duplicates before maintenance or any Google/email work begins.
    const claimed = await env.GOOGLE_SESSIONS.prepare(
      "INSERT OR IGNORE INTO streamlion_coordination_rates_v1(key,window,count) VALUES(?,?,1)",
    )
      .bind(
        await hash("coordination-schedule:" + grant.mode + ":" + grant.nonce),
        Math.floor(now / 3600000),
      )
      .run();
    if (claimed?.meta?.changes !== 1) return reply(409);
    // A valid scheduler credential still cannot start more than one maintenance
    // batch per mode per minute. A failed/uncertain batch waits for the next cron.
    const slot = await env.GOOGLE_SESSIONS.prepare(
      "INSERT OR IGNORE INTO streamlion_coordination_rates_v1(key,window,count) VALUES(?,?,1)",
    )
      .bind(
        await hash(
          "coordination-schedule-slot:" +
            grant.mode +
            ":" +
            Math.floor(now / 60000),
        ),
        Math.floor(now / 3600000),
      )
      .run();
    if (slot?.meta?.changes !== 1) return reply(409);
    return reply(200, await maintain(env, now));
  } catch {
    return reply(503);
  }
}
