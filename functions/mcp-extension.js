import { createMcpHandler } from "agents/mcp/server";
import { createExtensionMcpServer } from "../server/extension-mcp.js";
import { EXTENSION_HTML } from "../server/generated/extension-ui.js";
import { extensionJson, authenticateHeader } from "../server/extension-auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  const hostname = new URL(request.url).hostname;
  if (
    ![
      "streamlion.transcendencemedia.com",
      "streamlion.pages.dev",
      "localhost",
      "127.0.0.1",
    ].includes(hostname) &&
    !hostname.endsWith(".streamlion.pages.dev")
  )
    return extensionJson({ error: "Unknown host" }, 403);
  const handle = createMcpHandler(
    () => createExtensionMcpServer({ env, request, html: EXTENSION_HTML }),
    {
      route: "/mcp-extension",
      responseMode: "json",
      allowedHostnames: [hostname],
    },
  );
  const response = await handle(request, env, context);
  // Prevent any public cache from serving account-specific tool responses.
  response.headers.set("Cache-Control", "no-store");
  if (env.GOOGLE_AUTH_ORIGIN && response.status === 401)
    response.headers.set("WWW-Authenticate", authenticateHeader(env));
  return response;
}
