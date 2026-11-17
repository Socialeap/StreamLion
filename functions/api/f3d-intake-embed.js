import { PROFILE_AUDIENCE } from "../../src/f3d-profile.js";
import { manageIntakeEmbed } from "../../server/intake-embeds.js";
import { publicForm } from "../../server/public-intake.js";
import { boundedText } from "../../server/request-body.js";
import { CoordinationError } from "../../src/client-workflow.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const slug = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const token = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

async function signedByFrontiers(request, env, body) {
  const stamp = request.headers.get("X-F3D-Embed-Timestamp");
  const signature = request.headers.get("X-F3D-Embed-Signature");
  if (!/^\d{13}$/.test(stamp) || (Number(stamp) > Date.now() + 5000 || Number(stamp) + 30_000 <= Date.now()) ||
      !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  try {
    const jwk = JSON.parse(env.F3D_PROVIDER_PROFILE_PUBLIC_JWK);
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || Object.hasOwn(jwk, "d")) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, "Ed25519", false, ["verify"]);
    const bytes = Uint8Array.from(atob(signature.replaceAll("-", "+").replaceAll("_", "/") + "=="), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("Ed25519", key, bytes, encoder.encode("f3d.intake-embed.v1\n" + stamp + "\n" + body));
    return valid ? { expiresAt: Number(stamp) + 30_000 } : null;
  } catch {
    return false;
  }
}

export async function onRequest({ request, env }) {
  const reply = (body, status) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  const unavailable = () => reply({ error: "The F|3D website embed is unavailable." }, 404);
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (request.url !== PROFILE_AUDIENCE + "/api/f3d-intake-embed" ||
      env.GOOGLE_AUTH_ORIGIN !== PROFILE_AUDIENCE ||
      env.ENABLE_INTAKE_EMBEDS !== "true" ||
      env.ENABLE_F3D_PROFILE_BRIDGE !== "true" ||
      !request.headers.get("Content-Type")?.startsWith("application/json")) return unavailable();
  try {
    const body = await boundedText(request, 2048);
    const authorization = await signedByFrontiers(request, env, body);
    if (!authorization) return unavailable();
    const input = JSON.parse(body);
    if (!input || !["read", "save", "disable"].includes(input.action) ||
        !uuid.test(input.accountId) || !uuid.test(input.profileId) ||
        !slug.test(input.slug) || !token.test(input.token) || !uuid.test(input.commandId)) return unavailable();
    const form = await publicForm(env, input.token);
    return reply(await manageIntakeEmbed(env, form, input, authorization), 200);
  } catch (error) {
    return error instanceof CoordinationError && error.status === 400
      ? reply({ error: error.message }, 400)
      : unavailable();
  }
}
