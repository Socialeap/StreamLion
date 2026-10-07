let windowStart = 0,
  failuresLogged = 0;
function routeClass(request) {
  const path = new URL(request.url).pathname;
  for (const route of ["google", "extension", "purchase", "credits", "ai"])
    if (path === `/api/${route}` || path.startsWith(`/api/${route}/`))
      return route;
  if (path === "/api/health") return "health";
  if (path === "/mcp" || path === "/mcp-extension") return "mcp";
  return "other";
}
function failure(request, requestId, status, started) {
  const now = Date.now();
  if (now - windowStart >= 60000) {
    windowStart = now;
    failuresLogged = 0;
  }
  if (failuresLogged++ >= 60) return;
  // Fixed categories and generated IDs only. No URL, query, headers, payload,
  // exception text, account IDs or upstream responses enter application logs.
  console.error(
    JSON.stringify({
      service: "streamlion",
      event: "request_failure",
      requestId,
      route: routeClass(request),
      status,
      elapsedMs: Math.max(0, now - started),
    }),
  );
}
export async function onRequest(context) {
  const requestId = crypto.randomUUID(),
    started = Date.now();
  let response;
  try {
    response = await context.next();
  } catch {
    response = new Response(
      JSON.stringify({
        error: "Service temporarily unavailable. Please try again.",
        requestId,
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  if (response.status === 101) return response;
  if (response.status >= 500)
    failure(context.request, requestId, response.status, started);
  const headers = new Headers(response.headers);
  headers.set("X-StreamLion-Request-ID", requestId);
  if (response.status >= 500) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
