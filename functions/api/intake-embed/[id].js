import { coordinationReady } from "../../../server/coordination-readiness.js";
import { readIntakeEmbed } from "../../../server/intake-embeds.js";
import { CoordinationError } from "../../../src/client-workflow.js";

function unavailable(status = 404) {
  return new Response(
    "This website form is unavailable. Contact the provider.",
    {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

export async function onRequest({ request, env, params }) {
  if (!["GET", "HEAD"].includes(request.method)) return unavailable(405);
  if (
    env.ENABLE_INTAKE_EMBEDS !== "true" ||
    new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN
  )
    return unavailable();
  try {
    if (!(await coordinationReady(env))) return unavailable();
    const embed = await readIntakeEmbed(env, params.id);
    const asset = await env.ASSETS.fetch(
      new URL("/intake-embed-shell", request.url),
    );
    if (
      !asset.ok ||
      !asset.headers.get("Content-Type")?.startsWith("text/html")
    )
      return unavailable(503);
    return new Response(request.method === "HEAD" ? null : asset.body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // Supply a complete policy. Adding a second policy would still enforce
        // the underlying static shell's same-origin framing restriction.
        "Content-Security-Policy": [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self'",
          "connect-src 'self'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-ancestors " + embed.origins.join(" "),
        ].join("; "),
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy":
          "camera=(), microphone=(), geolocation=(), payment=()",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return unavailable(error instanceof CoordinationError ? error.status : 503);
  }
}
