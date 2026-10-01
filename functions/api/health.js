import { googleConfigurationReady } from "../../server/google-auth.js";
export function onRequest({ request, env }) {
  const persistent = env.ENABLE_PERSISTENT_GOOGLE === "true";
  const configured = persistent
    ? googleConfigurationReady(env)
    : Boolean(env.VITE_GOOGLE_CLIENT_ID);
  const value = {
    service: "streamlion",
    schema: 1,
    status: configured ? "ready" : "setup-required",
    googleMode: persistent ? "persistent" : "browser-session",
  };
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(value),
    {
      status: configured ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
