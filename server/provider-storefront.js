import { PROFILE_AUDIENCE, PROFILE_ISSUER } from "../src/f3d-profile.js";
import { assistantSupported } from "../src/request-assistant.js";
import { validatePricing } from "../src/provider-pricing.js";
import { unseal } from "./google-auth.js";
import { linkedBusinessProfileId } from "./f3d-profile.js";
import { publicForm } from "./public-intake.js";
import { approvedProfileEmbedId } from "./intake-embeds.js";
import { boundedText } from "./request-body.js";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const profilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function storefrontPricing(descriptor) {
  if (!descriptor.pricing?.config) return null;
  const config = validatePricing(descriptor.pricing.config);
  if (config.method === "quote") return null;
  return {
    method: config.method,
    currency: config.currency,
    rate: config.rate,
    tiers: config.tiers,
    minimumPrice: config.minimumPrice ?? null,
    extras: config.extras.map(({ name, unit, price, required }) => ({ name, unit, price, required })),
  };
}

function reply(data, status) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// POST keeps the already-public form token out of request URLs. This endpoint
// performs no writes and intentionally returns no visit ID or form answers.
export async function handleProviderStorefront({ request, env }) {
  const unavailable = () => reply({ error: "Provider form unavailable." }, 404);
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (new URL(request.url).origin !== PROFILE_AUDIENCE ||
      env.GOOGLE_AUTH_ORIGIN !== PROFILE_AUDIENCE) return unavailable();
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return reply({ error: "Use JSON." }, 415);

  let input;
  try {
    input = JSON.parse(await boundedText(request, 1024));
  } catch (error) {
    return reply({ error: "Invalid request." }, error.status === 413 ? 413 : 400);
  }
  if (!input || typeof input.token !== "string" || !tokenPattern.test(input.token) ||
      typeof input.profileId !== "string" || !profilePattern.test(input.profileId))
    return unavailable();

  try {
    const { row, connection } = await publicForm(env, input.token);
    if ((await linkedBusinessProfileId(env, connection)) !== input.profileId) return unavailable();
    const descriptor = await unseal(env, row.descriptor, "public-form:" + row.id);
    const embedId = await approvedProfileEmbedId(env, row.id, PROFILE_ISSUER);
    const name = descriptor.intake?.name;
    const formName = typeof name === "string" && name.trim() && name.length <= 120 &&
      !/[\x00-\x1f\x7f]/.test(name) ? name.trim() : null;
    return reply({
      version: 1,
      formName,
      guided: assistantSupported(descriptor),
      pricing: storefrontPricing(descriptor),
      embedId,
    }, 200);
  } catch {
    return unavailable();
  }
}
