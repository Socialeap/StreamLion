import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("Web Push encryption and VAPID request construction work in the actual Workers runtime", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import { buildPushPayload } from '@block65/webcrypto-web-push';
      const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      export default { async fetch() {
        const vapid = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
        const device = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
        const subscription = {endpoint:'https://fcm.googleapis.com/fcm/send/synthetic', keys:{p256dh:encode(await crypto.subtle.exportKey('raw',device.publicKey)),auth:encode(crypto.getRandomValues(new Uint8Array(16)))}};
        const options = await buildPushPayload({data:JSON.stringify({url:'/api/client-portal?job=synthetic'}),options:{ttl:300}},subscription,{publicKey:encode(await crypto.subtle.exportKey('raw',vapid.publicKey)),privateKey:(await crypto.subtle.exportKey('jwk',vapid.privateKey)).d,subject:'mailto:owner@example.com'});
        const request = new Request(subscription.endpoint,{...options,redirect:'manual',signal:AbortSignal.timeout(10000)});
        // Construct the production request without performing a network send.
        return Response.json({encoding:request.headers.get('Content-Encoding'),vapid:request.headers.get('Authorization').startsWith('vapid '),bytes:(await request.arrayBuffer()).byteLength,ttl:request.headers.get('TTL'),redirect:request.redirect});
      }}
    `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-23",
      script: bundle.outputFiles[0].text,
    }),
  );
  try {
    const response = await mf.dispatchFetch("http://localhost");
    const raw = await response.text();
    assert.equal(response.status, 200, raw);
    assert.deepEqual(JSON.parse(raw), {
      encoding: "aes128gcm",
      vapid: true,
      bytes: 4096,
      ttl: "300",
      redirect: "manual",
    });
  } finally {
    await mf.dispose();
  }
});
