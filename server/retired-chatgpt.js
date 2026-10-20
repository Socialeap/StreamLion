// Old installations must fail before authentication, workbook access or tool discovery.
export function retiredChatGPTResponse(request) {
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({
          error: "chatgpt_route_retired",
          message:
            "The StreamLion ChatGPT integration has been retired. Use the StreamLion workspace.",
        }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export function isRetiredChatGPTRoute(path) {
  return (
    ["/mcp", "/mcp-extension", "/api/extension"].some(
      (route) => path === route || path.startsWith(route + "/"),
    ) ||
    /^\/extension\.html\/?$/.test(path) ||
    /^\/\.well-known\/oauth-authorization-server\/?$/.test(path) ||
    /^\/\.well-known\/oauth-protected-resource\/mcp-extension\/?$/.test(path)
  );
}
