import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
test("real Workers/D1 deduplicates concurrent refund requests and processor leases without real provider calls", async () => {
  const now = Date.now(),
    schema = new DatabaseSync(":memory:");
  const bundle = await build({
    stdin: {
      contents: `import {recordRefundRequest,processRefundQueue} from './server/core-guarantee.js';let created=0;globalThis.fetch=async()=>{throw Error('External calls prohibited')};const refunds=[];const stripe={checkout:{sessions:{retrieve:async()=>({livemode:false,payment_status:'paid',amount_total:3261,payment_intent:{id:'pi_one',status:'succeeded',metadata:{app:'streamlion',order_id:'one'},latest_charge:{id:'ch_one',livemode:false,paid:true,captured:true,currency:'usd',amount:3261}}})}},refunds:{list:async()=>({has_more:false,data:refunds}),create:async(body)=>{created++;const r={id:'re_one',charge:'ch_one',currency:'usd',status:'succeeded',amount:body.amount,metadata:body.metadata};refunds.push(r);return r}}};export default{async fetch(request,env){env={...env,GOOGLE_SESSIONS:env.DB,STREAMLION_CORE_REFUNDS_ENABLED:'true',STREAMLION_PAYMENTS_MODE:'test'};const path=new URL(request.url).pathname;if(path==='/request')await recordRefundRequest(env,'test','buyer',${now});if(path==='/process')await processRefundQueue(env,stripe,${now});return Response.json({created})}};`,
      resolveDir: new URL("../../", import.meta.url).pathname,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["node:buffer"],
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-23",
      compatibilityFlags: ["nodejs_compat"],
      script: bundle.outputFiles[0].text,
      d1Databases: ["DB"],
    }),
  );
  try {
    for (const name of [
      "0004_streamlion_purchases",
      "0005_streamlion_launch_200",
      "0026_core_guarantee",
    ])
      schema.exec(
        readFileSync(
          new URL("../../migrations/" + name + ".sql", import.meta.url),
          "utf8",
        ),
      );
    const db = await mf.getD1Database("DB");
    const ddl = schema
      .prepare(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name",
      )
      .all();
    await db.batch(ddl.map((r) => db.prepare(r.sql)));
    await db
      .prepare("INSERT INTO streamlion_core_guarantee_schema_v1 VALUES(1)")
      .run();
    await db
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at,checkout_session,payment_intent,core_offer,refund_days,paid_at) VALUES('one','test','buyer','buyer@example.com','price_one','prod_one',2995,'usd','paid',1,2,3,'cs_one','pi_one','payment-14-days-unconditional-v1',14,?)",
      )
      .bind(now - 1000)
      .run();
    const request = (path) =>
      mf.dispatchFetch("https://fixture.example/" + path);
    assert(
      (
        await Promise.all(Array.from({ length: 12 }, () => request("request")))
      ).every((r) => r.status === 200),
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM streamlion_core_refund_requests_v1")
          .first()
      ).n,
      1,
    );
    assert(
      (
        await Promise.all(Array.from({ length: 12 }, () => request("process")))
      ).every((r) => r.status === 200),
    );
    const end = await (await request("status")).json();
    assert.equal(end.created, 1);
    assert.equal(
      (
        await db
          .prepare("SELECT state FROM streamlion_core_refund_requests_v1")
          .first()
      ).state,
      "succeeded",
    );
    assert.equal(
      (
        await db
          .prepare("SELECT received_at FROM streamlion_core_refund_requests_v1")
          .first()
      ).received_at,
      now,
    );
  } finally {
    schema.close();
    await mf.dispose();
  }
});
