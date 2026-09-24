import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  STREAMLION_APP_URL,
  STREAMLION_WIDGET_HTML,
  STREAMLION_WIDGET_URI,
} from "../src/mcp-widget.js";
import { z } from "zod";

const SAMPLE = Object.freeze({
  kind: "sample",
  title: "Example venue capture",
  city: "Brooklyn",
  visit: "Date to confirm",
  review: "Draft",
});

export function createStreamLionMcpServer() {
  const server = new McpServer({ name: "StreamLion UI prototype", version: "0.1.0" });

  registerAppResource(
    server,
    "StreamLion workspace",
    STREAMLION_WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: STREAMLION_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: STREAMLION_WIDGET_HTML,
          _meta: {
            ui: {
              prefersBorder: true,
              domain: STREAMLION_APP_URL.slice(0, -1),
              csp: { frameDomains: [STREAMLION_APP_URL.slice(0, -1)] },
            },
            "openai/widgetDescription": "Open the existing StreamLion field workspace in ChatGPT or a browser. The example card contains no customer data.",
            "openai/widgetCSP": {
              redirect_domains: [STREAMLION_APP_URL.slice(0, -1)],
            },
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "show_streamlion_workspace",
    {
      title: "Show StreamLion workspace",
      description:
        "Show a small StreamLion card that can expand to the existing field workspace inside ChatGPT. This tool does not read a Google workbook, accept credentials, or save records. Use the connected Google tools for project questions.",
      inputSchema: {},
      outputSchema: { kind: z.literal("workspace") },
      annotations: { readOnlyHint: true, openWorldHint: false },
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        ui: { resourceUri: STREAMLION_WIDGET_URI },
        securitySchemes: [{ type: "noauth" }],
      },
    },
    async () => ({
      structuredContent: { kind: "workspace" },
      content: [
        {
          type: "text",
          text: "StreamLion workspace card shown. Google records were not read. Open the workspace only if the user needs to edit or review it.",
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "show_streamlion_example",
    {
      title: "Show a sample StreamLion project card",
      description:
        "Show the fixed synthetic project card used to test StreamLion's in-chat UI. This is an example only and must never be described as a real Google record.",
      inputSchema: {},
      outputSchema: {
        kind: z.literal("sample"),
        title: z.string(),
        city: z.string(),
        visit: z.string(),
        review: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        ui: { resourceUri: STREAMLION_WIDGET_URI },
        securitySchemes: [{ type: "noauth" }],
      },
    },
    async () => ({
      structuredContent: SAMPLE,
      content: [
        {
          type: "text",
          text: "Synthetic example project card shown. No Google workbook was accessed.",
        },
      ],
    }),
  );

  return server;
}

export async function onRequest(context) {
  const hostname = new URL(context.request.url).hostname;
  if (
    hostname !== "streamlion.transcendencemedia.com" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "streamlion.pages.dev" &&
    !hostname.endsWith(".streamlion.pages.dev")
  ) {
    return new Response("Unknown host", { status: 403 });
  }
  const handle = createMcpHandler(createStreamLionMcpServer, {
    route: "/mcp",
    responseMode: "json",
    allowedHostnames: [hostname],
  });
  return handle(context.request, context.env, context);
}
