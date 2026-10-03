import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Loopback-only synthetic host, never bundled into the deployed PWA or MCP UI.
const root = fileURLToPath(new URL("../", import.meta.url));
const at = process.argv.indexOf("--port");
const port = at >= 0 ? Number(process.argv[at + 1]) : 8792;
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Choose a port between 1024 and 65535.");
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["test/extension-host.mjs"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const routes = {
  "/": {
    type: "text/html; charset=utf-8",
    text: await readFile(root + "test/extension-host.html"),
  },
  "/host.js": {
    type: "text/javascript; charset=utf-8",
    text: bundle.outputFiles[0].text,
  },
  "/extension.html": {
    type: "text/html; charset=utf-8",
    text: await readFile(root + "dist/extension.html"),
  },
};
const server = createServer((request, response) => {
  const route = routes[new URL(request.url, "http://127.0.0.1").pathname];
  if (request.method !== "GET" || !route) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": route.type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(route.text);
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Synthetic extension preview: http://127.0.0.1:${port}`),
);
process.once("SIGINT", () => server.close());
