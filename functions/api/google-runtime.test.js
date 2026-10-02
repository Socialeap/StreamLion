import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { googleFetch } from "../../server/google-auth.js";

test("Google fetch works in workerd and rejects redirects without forwarding credentials", async () => {
  // Execute the production helper with Workers' actual Request and AbortSignal.
  // The synthetic fetch constructs that Request before returning a stub response.
  // No network request or real credential is used.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-23",
      compatibilityFlags: ["nodejs_compat"],
      script: `
      let calls = 0;
      async function fetch(url, init) {
        const request = new Request(url, init);
        if (request.redirect !== 'manual') throw new Error('unsafe_redirect_mode');
        calls++;
        return new Response('synthetic', {
          status: url.endsWith('/redirect') ? 302 : 200,
          headers: { Location: 'https://untrusted.example' }
        });
      }
      ${googleFetch.toString()}
      export default { async fetch() {
        const response = await googleFetch('https://synthetic.example/token', {
          method: 'POST', body: new URLSearchParams({client_secret:'synthetic'}),
          headers: { Authorization: 'Bearer synthetic' }
        });
        let rejected = false;
        try { await googleFetch('https://synthetic.example/redirect', {
          headers: { Authorization: 'Bearer synthetic' }
        }); } catch(e) { rejected = e.message === 'google_redirect_rejected'; }
        return Response.json({status:response.status, rejected, calls});
      }}
    `,
    }),
  );
  try {
    const response = await mf.dispatchFetch("http://localhost");
    assert.deepEqual(await response.json(), {
      status: 200,
      rejected: true,
      calls: 2,
    });
  } finally {
    await mf.dispose();
  }
});
