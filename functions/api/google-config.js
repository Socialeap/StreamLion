/**
 * Return the browser-visible Google application settings.
 * These values are public by design; never bind a Google client secret here.
 */
export function onRequestGet({ env }) {
  const config = {
    clientId: env.VITE_GOOGLE_CLIENT_ID || "",
    apiKey: env.VITE_GOOGLE_PICKER_API_KEY || "",
    appId: env.VITE_GOOGLE_PROJECT_NUMBER || "",
  };

  return new Response(JSON.stringify(config), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
