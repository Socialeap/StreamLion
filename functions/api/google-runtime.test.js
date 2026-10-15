import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { googleFetch } from "../../server/google-auth.js";
import {
  boundedText,
  boundedBytes,
  RequestBodyError,
} from "../../server/request-body.js";

test("native base64 conversion preserves large payloads in the actual Workers runtime", async () => {
  const source = readFileSync(
    new URL("../../server/base64.js", import.meta.url),
    "utf8",
  );
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-23",
      compatibilityFlags: ["nodejs_compat"],
      script: `${source}
      export default { async fetch() {
        const bytes = new Uint8Array(700000);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
        const encoded = base64url(bytes);
        const decoded = base64urlBytes(encoded);
        const standard = base64Bytes(encoded.replaceAll('-', '+').replaceAll('_', '/'));
        let invalidRejected = false;
        try { base64urlBytes(encoded + '!'); } catch { invalidRejected = true; }
        return Response.json({
          length: decoded.length,
          equal: bytes.every((byte, i) => byte === decoded[i] && byte === standard[i]),
          invalidRejected
        });
      }}
    `,
    }),
  );
  try {
    assert.deepEqual(
      await (await mf.dispatchFetch("http://localhost")).json(),
      {
        length: 700000,
        equal: true,
        invalidRejected: true,
      },
    );
  } finally {
    await mf.dispose();
  }
});

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
test("bounded streaming reads cancel early in the actual Workers runtime", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-23",
      compatibilityFlags: ["nodejs_compat"],
      script: `${RequestBodyError.toString()}\n${boundedBytes.toString()}\n${boundedText.toString()}\nexport default { async fetch() {
      let reads = 0, cancelled = false;
      const body = new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
      let status;
      try { await boundedText(new Request('https://synthetic.example', {method:'POST',body}),12000); } catch(e) { status = e.status; }
      return Response.json({status,reads,cancelled});
    }} `,
    }),
  );
  try {
    assert.deepEqual(
      await (await mf.dispatchFetch("http://localhost")).json(),
      { status: 413, reads: 3, cancelled: true },
    );
  } finally {
    await mf.dispose();
  }
});
