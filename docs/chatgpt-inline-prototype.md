# StreamLion in ChatGPT: first prototype

This prototype adds a Cloudflare Pages Function at `/mcp` and a bundled MCP server entry in `plugin/mcp.json`. The server offers two read-only tools:

- `show_streamlion_workspace`: a compact card that opens the existing StreamLion PWA in ChatGPT's expanded view when the host permits nested frames.
- `show_streamlion_example`: a fixed synthetic project card for visual smoke tests.

The MCP endpoint has no user authentication. It accepts no workbook ID, credentials, or customer data, and does not read or write Google records. Real project questions still use the ChatGPT host's Google Drive/Sheets connection under the plugin skill. The PWA's Google OAuth connection is separate. This separation prevents one user's private workbook data from becoming available through a public endpoint.

## Verify locally

Use Node 22 or later:

```sh
npm ci
npm test
npm run build
npx wrangler pages dev dist --port 8788
```

From another terminal, run `npm run smoke:mcp` to initialize the MCP endpoint, check the two tools and their results, and read `ui://streamlion/workspace-v2.html`. After deployment, repeat with `npm run smoke:mcp -- https://streamlion.transcendencemedia.com/mcp`. Then preview the UI in a ChatGPT developer-mode connection.

## Activation and live checks

1. Merge the reviewed PR. Cloudflare Pages must build `main` and publish the Pages Function and frontend. `wrangler.jsonc` carries `nodejs_compat` for the MCP handler. There are no migrations, new secrets, provider settings, or database changes.
2. Verify `https://streamlion.transcendencemedia.com/mcp` responds to MCP initialize and exposes exactly the two prototype tools. Do not claim this from a build log alone.
3. Update the private StreamLion plugin from the committed `plugin/` package (version 0.74.0), or register the HTTPS MCP endpoint in ChatGPT developer mode for pilot testing. Confirm that the UI resource renders in an actual ChatGPT conversation. Plugin publication and MCP deployment are separate actions.
4. Test the embedded PWA's Google sign-in, workbook selection, project editing, field-note recording, and return to chat on desktop and phone. The MCP resource requests microphone permission and its child frame delegates it; the host and browser must still grant access after the user taps Record audio. Browser policies or ChatGPT review may block nested Google or microphone flows. The card retains an “Open in browser” route for that case.
5. Use only synthetic records for the first end-to-end test. Real workbook reads, answers, and saves remain governed by the connected Google tools and the existing revision checks. Do not treat the synthetic card as proof of live Google access.

The iframe is restricted to `https://streamlion.transcendencemedia.com`, the same registrable domain as the MCP server. ChatGPT review may still require an embedding justification or reject it. A later one-time workbook connection requires per-user MCP OAuth authorization and a protected workbook-binding design; this prototype does not claim to implement that.

## Optional prototype; ordinary ChatGPT is the primary handoff

The private plugin remains available for experiments. Its desktop-only distribution is not a dependency of the customer PWA. Projects and Ask now lead to ordinary ChatGPT with a prepared message; Ask copies a dated snapshot containing the selected project's actual details and field records. The user pastes it once. Brief extraction returns a project file for import and source review in the PWA. No hidden Google session, automatic chat submission, or embedded consumer chat is claimed.

The MCP server still has no per-user authorization or workbook access. Its card does not prove Google roundtrip or microphone support. A future public ChatGPT integration would require separate review and a tested authorization boundary. It is not a launch gate for the ordinary ChatGPT path. No plugin republishing or MCP deployment change is required for the provider workflow release.
