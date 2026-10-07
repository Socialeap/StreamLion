import { boundedText } from "./request-body.js";
import { notificationsSchema } from "./coordination-notifications.js";
import { applyResendEvents } from "./resend-events.js";

// Svix signs the exact raw body with the endpoint-specific webhook secret.
export async function handleResendWebhook({ request, env }) {
  const reply = (status) =>
    new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return reply(405);
  if (!env.RESEND_WEBHOOK_SECRET || !(await notificationsSchema(env)))
    return reply(503);
  try {
    const raw = await boundedText(request, 100000);
    const id = request.headers.get("svix-id"),
      stamp = request.headers.get("svix-timestamp");
    const signatures = request.headers.get("svix-signature") || "";
    if (
      !id ||
      id.length > 200 ||
      !/^\d{10}$/.test(stamp || "") ||
      Math.abs(Date.now() / 1000 - Number(stamp)) > 300
    )
      return reply(401);
    const secret = env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, "");
    const bytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(id + "." + stamp + "." + raw);
    let verified = false;
    for (const value of signatures.split(" ").slice(0, 6)) {
      if (!value.startsWith("v1,")) continue;
      try {
        verified ||= await crypto.subtle.verify(
          "HMAC",
          key,
          Uint8Array.from(atob(value.slice(3)), (c) => c.charCodeAt(0)),
          signed,
        );
      } catch {
        /* Ignore malformed signatures, never their payload. */
      }
    }
    if (!verified) return reply(401);
    const event = JSON.parse(raw);
    const status = {
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.complained": "complained",
      "email.failed": "failed",
    }[event.type];
    if (status && typeof event.data?.email_id === "string") {
      if (event.data.email_id.length > 100) return reply(400);
      // Persist receipt metadata even when the webhook arrives before the send response.
      await env.GOOGLE_SESSIONS.prepare(
        "INSERT OR IGNORE INTO streamlion_coordination_email_events_v1(event_id,provider_id,status,created_at) VALUES(?,?,?,?)",
      )
        .bind(id, event.data.email_id, status, Date.now())
        .run();
      await applyResendEvents(env.GOOGLE_SESSIONS, event.data.email_id);
    }
    return reply(204);
  } catch {
    return reply(400);
  }
}
