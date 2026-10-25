// Synthetic localhost-only preview. Never binds production D1 or calls providers.
import { createServer } from "vite";
import { adminFixture, ADMIN_NOW } from "../test/admin-fixture.js";
import { observeAccount, observeActivity } from "../server/admin-data.js";
import { reserveProject, finishProject } from "../server/shared-credits.js";
import { handleAdmin } from "../server/admin-portal.js";
const f = await adminFixture({ after() {} }),
  clock = ADMIN_NOW;
f.env.STREAMLION_PAYMENTS_MODE = "live";
f.db
  .prepare(
    "UPDATE streamlion_google_sessions_v1 SET google_subject='owner',email='shakoure@transcendencemedia.com' WHERE session_hash=?",
  )
  .run(f.sessionHash);
f.db
  .prepare(
    "INSERT INTO streamlion_admin_windows_v1 VALUES(?,'owner','live',?,?,?)",
  )
  .run(f.sessionHash, clock, clock, clock);
for (const [i, name] of [
  "Jamie Field",
  "Morgan Ellis",
  "Alex Rivera",
  "Sam Jordan",
  "Taylor Brooks",
  "Casey Lane",
  "Avery Chen",
  "Jordan Reed",
].entries()) {
  const subject = i ? "preview-" + i : "account-a";
  if (i) f.paid(subject);
  await observeAccount(
    f.env.GOOGLE_SESSIONS,
    {
      sub: subject,
      email: name.split(" ")[0].toLowerCase() + "@example.invalid",
    },
    "live",
    clock - i * 2 * 86400000,
  );
  f.db
    .prepare(
      "UPDATE streamlion_accounts_v1 SET name=?,business=?,first_known_at=?,signup_at=? WHERE google_subject=?",
    )
    .run(
      name,
      ["Field Studio", "Northside Tours", "Coastal Capture", "Studio Works"][
        i % 4
      ],
      clock - (i + 1) * 2 * 86400000,
      i % 3 ? clock - (i + 1) * 2 * 86400000 : null,
      subject,
    );
  f.db
    .prepare(
      "INSERT INTO streamlion_credit_orders_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,credits_micros,created_at,expires_at,updated_at) VALUES(?,'live',?,'fixture@example.invalid','price','prod',1000,'usd',10000000,?,?,?)",
    )
    .run(
      "preview-credit-" + i,
      subject,
      clock - i * 86400000,
      clock + 86400000,
      clock - i * 86400000,
    );
  f.db
    .prepare(
      "UPDATE streamlion_credit_orders_v1 SET status='paid',credited_micros=10000000 WHERE order_id=?",
    )
    .run("preview-credit-" + i);
  if (i < 4) f.grant(subject, 240, { id: "preview-grant-" + i });
  for (let d = 0; d < 7; d++)
    if ((i + d) % 3 !== 0)
      await observeActivity(
        f.env.GOOGLE_SESSIONS,
        "live",
        subject,
        clock - d * 86400000,
        clock,
      );
  if (i < 3) {
    await reserveProject(
      f.env.GOOGLE_SESSIONS,
      "live",
      subject,
      "preview-project-" + i,
      clock - i * 86400000,
    );
    await finishProject(
      f.env.GOOGLE_SESSIONS,
      "live",
      subject,
      "preview-project-" + i,
      "complete",
    );
  }
  if (i === 7)
    f.db
      .prepare(
        "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject=?",
      )
      .run(subject);
}
const server = await createServer({
  server: { host: "127.0.0.1", port: 5179, strictPort: true },
  plugins: [
    {
      name: "synthetic-admin-preview",
      configureServer(s) {
        s.middlewares.use("/api/admin", async (req, res) => {
          try {
            let body = "";
            for await (const c of req) {
              body += c;
              if (body.length > 8192) throw Error("fixture input too large");
            }
            const path = (req.url || "/session")
              .split("?")[0]
              .replace(/^\//, "");
            if (!path || path === "close") {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ closed: true }));
              return;
            }
            const requestNow = Date.now();
            f.db
              .prepare(
                "UPDATE streamlion_admin_windows_v1 SET verified_at=? WHERE id=?",
              )
              .run(requestNow, f.sessionHash); // Synthetic assurance only.
            const response = await handleAdmin(
              {
                env: f.env,
                params: { path: path.split("/") },
                request: new Request(
                  "https://app.example/api/admin" + req.url,
                  {
                    method: req.method,
                    headers: {
                      Origin: "https://app.example",
                      Cookie: "__Host-streamlion-session=" + f.cookie,
                      "Content-Type": "application/json",
                      "X-StreamLion-Account": "owner",
                    },
                    ...(req.method === "POST" ? { body: body || "{}" } : {}),
                  },
                ),
              },
              { now: () => requestNow },
            );
            const value = await response.json();
            if (path === "session") value.preview = true;
            res.statusCode = response.status;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(value));
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Synthetic preview error" }));
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(
  "Synthetic admin preview: http://127.0.0.1:5179/admin/ (fixture data only)",
);
const stop = async () => {
  await server.close();
  f.db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
