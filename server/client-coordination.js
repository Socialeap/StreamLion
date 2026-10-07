import {
  getSession,
  hash,
  seal,
  unseal,
  googleConfigurationReady,
} from "./google-auth.js";
import { hasPurchase, paymentMode } from "./purchase-access.js";
import { boundedText } from "./request-body.js";
import { CoordinationGoogle } from "./coordination-google.js";
import {
  CoordinationEngine,
  operationID,
  queueNotice,
} from "./coordination-engine.js";
import { grantStarter, sharedWallet } from "./shared-credits.js";
import {
  newClientJob,
  clientView,
  CoordinationError,
  DAY,
  readiness,
} from "../src/client-workflow.js";
const COOKIE = "__Host-streamlion-client";
const random = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const cookie = (request) =>
  request.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
export const json = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
export async function coordinationReady(env) {
  if (
    env.ENABLE_CLIENT_COORDINATION !== "true" ||
    !googleConfigurationReady(env) ||
    !env.COORDINATION_MAILER ||
    !["test", "live"].includes(paymentMode(env)) ||
    env.STREAMLION_AI_CREDITS_MODE !== paymentMode(env)
  )
    return false;
  try {
    const schema = await env.GOOGLE_SESSIONS.prepare(
      "SELECT version FROM streamlion_coordination_schema_v1 WHERE version=1",
    ).first();
    const policy = await env.GOOGLE_SESSIONS.prepare(
      "SELECT active FROM streamlion_coordination_policy_v1 WHERE mode=?",
    )
      .bind(paymentMode(env))
      .first();
    return Boolean(schema && policy?.active === 1);
  } catch {
    return false;
  }
}
async function limited(env, key, maximum) {
  const window = Math.floor(Date.now() / 3600000);
  const row = await env.GOOGLE_SESSIONS.prepare(
    "INSERT INTO streamlion_coordination_rates_v1 VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END RETURNING count",
  )
    .bind(await hash(key), window)
    .first();
  if (!row || row.count > maximum)
    throw new CoordinationError("Too many attempts. Try again later.", 429);
}
async function bodyJSON(request, max = 50000) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new CoordinationError("Use JSON.", 415);
  try {
    return JSON.parse(await boundedText(request, max));
  } catch (error) {
    throw new CoordinationError(
      error.status === 413 ? "Request too large." : "Invalid request.",
      error.status || 400,
    );
  }
}
async function provider(request, env, unsafe) {
  const session = await getSession(request, env);
  if (!session)
    throw new CoordinationError(
      "Sign in to your provider Google account.",
      401,
    );
  if (
    unsafe &&
    request.headers.get("X-StreamLion-Account") !== session.google_subject
  )
    throw new CoordinationError(
      "Your Google account changed. Reopen this page.",
      403,
    );
  if (!(await hasPurchase(env, session.google_subject)))
    throw new CoordinationError("StreamLion Core purchase required.", 403);
  return session;
}
async function selectedConnection(env, session) {
  return env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_coordination_connections_v1 WHERE google_subject=? AND mode=? AND workbook_id=?",
  )
    .bind(session.google_subject, paymentMode(env), session.workbook_id || "")
    .first();
}
async function client(request, env) {
  const token = cookie(request);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || ""))
    throw new CoordinationError("Verify your email to open this project.", 401);
  const row = await env.GOOGLE_SESSIONS.prepare(
    "SELECT j.*,s.expires_at AS session_expires,s.revoked AS session_revoked FROM streamlion_coordination_sessions_v1 s JOIN streamlion_coordination_jobs_v1 j ON j.id=s.job_id WHERE s.hash=?",
  )
    .bind(await hash(token))
    .first();
  if (
    !row ||
    row.session_revoked ||
    row.session_expires <= Date.now() ||
    row.archived ||
    (row.archive_at && row.archive_at <= Date.now())
  )
    throw new CoordinationError(
      "Project access expired. Contact your provider.",
      401,
    );
  const connection = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
  )
    .bind(row.connection_id)
    .first();
  if (
    !connection ||
    connection.revoked ||
    connection.expires_at <= Date.now() ||
    connection.mode !== paymentMode(env)
  )
    throw new CoordinationError(
      "Your provider must renew project access.",
      409,
    );
  return { row, connection };
}
async function invite(env, row) {
  const token = random(),
    tokenHash = await hash(token),
    now = Date.now();
  await env.GOOGLE_SESSIONS.prepare(
    "INSERT INTO streamlion_coordination_challenges_v1 VALUES(?,?,?,0)",
  )
    .bind(tokenHash, row.id, now + 20 * 60000)
    .run();
  await queueNotice(env, row, "invite-" + tokenHash, {
    subject: "Open your StreamLion project",
    expiresAt: now + 20 * 60000,
    text: "This private sign-in link expires in 20 minutes. Open the link and press Verify to continue.",
    url:
      env.GOOGLE_AUTH_ORIGIN +
      "/api/client-portal?job=" +
      row.id +
      "#verify=" +
      token,
  });
}
async function projectStatus(request, env) {
  const session = await getSession(request, env);
  if (!session)
    throw new CoordinationError("Sign in to check client updates.", 401);
  const present = await env.GOOGLE_SESSIONS.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='streamlion_coordination_jobs_v1'",
  ).first();
  if (!present) return json({ managed: false });
  if (!(await hasPurchase(env, session.google_subject)))
    throw new CoordinationError("Provider purchase required.", 403);
  const row = await env.GOOGLE_SESSIONS.prepare(
    "SELECT c.* FROM streamlion_coordination_jobs_v1 j JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id WHERE j.id=? AND c.google_subject=? AND c.workbook_id=? AND c.mode=?",
  )
    .bind(
      new URL(request.url).searchParams.get("job"),
      session.google_subject,
      session.workbook_id || "",
      paymentMode(env),
    )
    .first();
  if (!row) return json({ managed: false });
  if (
    !(await coordinationReady(env)) ||
    row.revoked ||
    row.expires_at <= Date.now()
  )
    return json({ managed: true, available: false });
  const snapshot = await new CoordinationGoogle(env, row).snapshot(),
    id = new URL(request.url).searchParams.get("job"),
    job = snapshot.heads.get(id);
  const pending = await env.GOOGLE_SESSIONS.prepare(
    "SELECT id FROM streamlion_coordination_operations_v1 WHERE connection_id=? AND state='pending'",
  )
    .bind(row.id)
    .first();
  return json({
    managed: true,
    available: Boolean(job),
    revision: job?.revision,
    state: job?.state,
    projectRevision: snapshot.projects.heads.find((r) => r.recordId === id)
      ?.revisionId,
    pending: Boolean(pending),
    issues: job ? readiness(job) : [],
    updatedAt: job?.updatedAt,
  });
}
export async function handleCoordination({ request, env, params = {} }) {
  const route = Array.isArray(params.path)
    ? params.path.join("/")
    : params.path || "";
  const unsafe = request.method !== "GET";
  try {
    if (route === "provider/project" && request.method === "GET")
      return await projectStatus(request, env);
    if (!(await coordinationReady(env)))
      return json(
        {
          enabled: false,
          error: "Client coordination is awaiting activation.",
        },
        503,
      );
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      (unsafe && request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
    )
      throw new CoordinationError("Use the StreamLion project portal.", 403);
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "Method not allowed." }, 405);
    if (route === "client/request" && request.method === "POST") {
      const body = await bodyJSON(request, 2048);
      await limited(
        env,
        "request-ip:" + request.headers.get("CF-Connecting-IP"),
        20,
      );
      await limited(env, "request-job:" + body.jobId, 5);
      const row = await env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?",
      )
        .bind(String(body.jobId || "").slice(0, 100))
        .first();
      if (
        row &&
        !row.archived &&
        (!row.archive_at || row.archive_at > Date.now())
      ) {
        const email = await unseal(
          env,
          row.client_email,
          "job-email:" + row.id,
        );
        if (
          typeof body.email === "string" &&
          email.toLowerCase() === body.email.trim().toLowerCase()
        )
          await invite(env, row);
      }
      return json({
        message:
          "If the details match an open project, a private sign-in link will be sent.",
      });
    }
    if (route === "client/verify" && request.method === "POST") {
      const body = await bodyJSON(request, 1024);
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.token || ""))
        throw new CoordinationError("Invalid verification link.", 401);
      await limited(
        env,
        "verify-ip:" + request.headers.get("CF-Connecting-IP"),
        30,
      );
      const challengeHash = await hash(body.token),
        sessionToken = random(),
        sessionHash = await hash(sessionToken),
        now = Date.now();
      const results = await env.GOOGLE_SESSIONS.batch([
        env.GOOGLE_SESSIONS.prepare(
          "INSERT INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) SELECT ?,c.job_id,? FROM streamlion_coordination_challenges_v1 c JOIN streamlion_coordination_jobs_v1 j ON j.id=c.job_id WHERE c.hash=? AND c.consumed=0 AND c.expires_at>? AND j.archived=0 AND (j.archive_at IS NULL OR j.archive_at>?)",
        ).bind(sessionHash, now + 7 * DAY, challengeHash, now, now),
        env.GOOGLE_SESSIONS.prepare(
          "UPDATE streamlion_coordination_challenges_v1 SET consumed=1 WHERE hash=? AND consumed=0 AND expires_at>?",
        ).bind(challengeHash, now),
      ]);
      if (results[0].meta.changes !== 1)
        throw new CoordinationError(
          "Link expired or already used. Request a new link.",
          401,
        );
      return json({ verified: true }, 200, {
        "Set-Cookie":
          COOKIE +
          "=" +
          sessionToken +
          "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=" +
          7 * 86400,
      });
    }
    if (route === "client/logout" && request.method === "POST") {
      const token = cookie(request);
      if (token)
        await env.GOOGLE_SESSIONS.prepare(
          "UPDATE streamlion_coordination_sessions_v1 SET revoked=1 WHERE hash=?",
        )
          .bind(await hash(token))
          .run();
      return json({ signedOut: true }, 200, {
        "Set-Cookie":
          COOKIE + "=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
      });
    }
    if (route.startsWith("client/")) {
      const principal = await client(request, env),
        engine = new CoordinationEngine(env, principal.connection);
      if (route === "client/file" && request.method === "GET")
        return download(
          env,
          engine,
          principal.row.id,
          new URL(request.url).searchParams.get("id"),
          true,
        );
      if (route === "client/job" && request.method === "GET") {
        const snapshot = await engine.google.snapshot(),
          job = snapshot.heads.get(principal.row.id);
        if (!job)
          throw new CoordinationError(
            "Your provider is preparing this request. Try shortly.",
            409,
          );
        if (job.archiveAt && job.archiveAt <= Date.now())
          throw new CoordinationError(
            "Project access expired. Contact your provider.",
            401,
          );
        return json({
          job: clientView(job),
          brand: principal.connection.client_brand,
        });
      }
      const body = await bodyJSON(
        request,
        route === "client/upload" ? 750000 : 50000,
      );
      await limited(env, "client:" + principal.row.id, 120);
      if (route === "client/command" && request.method === "POST")
        if (body.command?.action === "attach")
          throw new CoordinationError("Use the attachment upload.", 403);
        else
          return json(
            await engine.command(
              body.operation,
              principal.row.id,
              body.command,
              { role: "client" },
            ),
          );
      if (route === "client/upload" && request.method === "POST")
        return json(
          await engine.upload(body.operation, principal.row.id, body.file, {
            role: "client",
          }),
        );
      if (route === "client/retry" && request.method === "POST") {
        const operation = await engine.operation(body.operation);
        if (
          !operation ||
          operation.job_id !== principal.row.id ||
          operation.actor !== "client"
        )
          throw new CoordinationError("Operation unavailable.", 404);
        return json(await engine.run(body.operation));
      }
      return json({ error: "Unknown client action." }, 404);
    }
    const session = await provider(request, env, unsafe);
    if (request.method === "POST")
      await limited(env, "provider:" + session.google_subject, 120);
    let connection = await selectedConnection(env, session);
    const policy = await env.GOOGLE_SESSIONS.prepare(
      "SELECT * FROM streamlion_coordination_policy_v1 WHERE mode=?",
    )
      .bind(paymentMode(env))
      .first();
    if (route === "provider/status" && request.method === "GET")
      return json({
        enabled: true,
        subject: session.google_subject,
        email: session.email,
        workbook: session.workbook_id,
        folder: session.folder_id,
        connected: Boolean(
          connection &&
          !connection.revoked &&
          connection.expires_at > Date.now(),
        ),
        expiresAt: connection?.expires_at,
        projectMicros: policy.project_micros,
        wallet: await sharedWallet(
          env.GOOGLE_SESSIONS,
          paymentMode(env),
          session.google_subject,
        ),
      });
    const body =
      request.method === "POST"
        ? await bodyJSON(request, route === "provider/upload" ? 750000 : 50000)
        : null;
    if (route === "provider/connect" && request.method === "POST") {
      if (
        body.consent !== true ||
        !/^[\w-]{1,100}$/.test(session.workbook_id || "") ||
        !/^[\w-]{1,100}$/.test(session.folder_id || "") ||
        typeof body.brand !== "string" ||
        !body.brand.trim() ||
        body.brand.length > 100
      )
        throw new CoordinationError(
          "Choose a Google workbook and private folder, then consent to background coordination.",
        );
      const credentials = await unseal(
        env,
        session.credentials,
        session.session_hash,
      );
      if (!credentials.refreshToken)
        throw new CoordinationError(
          "Reconnect Google with background access consent.",
          409,
        );
      const id =
        connection?.id ||
        (await hash(
          paymentMode(env) +
            ":" +
            session.google_subject +
            ":" +
            session.workbook_id,
        ));
      const value = {
        id,
        google_subject: session.google_subject,
        mode: paymentMode(env),
        workbook_id: session.workbook_id,
        folder_id: session.folder_id,
        client_brand: body.brand.trim(),
        credentials: await seal(env, credentials, id),
        expires_at: Date.now() + 365 * DAY,
        revoked: 0,
      };
      const enrolled = await env.GOOGLE_SESSIONS.prepare(
        "SELECT id FROM streamlion_coordination_connections_v1 WHERE workbook_id=?",
      )
        .bind(session.workbook_id)
        .first();
      if (enrolled && enrolled.id !== id)
        throw new CoordinationError(
          "This workbook is enrolled under another account or payment mode.",
          409,
        );
      if (connection && connection.folder_id !== value.folder_id)
        throw new CoordinationError(
          "Keep the enrolled private folder. Folder migration requires review.",
          409,
        );
      const google = new CoordinationGoogle(env, value);
      await google.privateFolder();
      await google.ensure();
      await env.GOOGLE_SESSIONS.prepare(
        "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(mode,google_subject,workbook_id) DO UPDATE SET credentials=excluded.credentials,client_brand=excluded.client_brand,expires_at=excluded.expires_at,revoked=0",
      )
        .bind(
          value.id,
          value.google_subject,
          value.mode,
          value.workbook_id,
          value.folder_id,
          value.credentials,
          value.client_brand,
          value.expires_at,
        )
        .run();
      await grantStarter(
        env.GOOGLE_SESSIONS,
        value.mode,
        value.google_subject,
        Date.now(),
      );
      return json({ connected: true });
    }
    if (
      !connection ||
      connection.revoked ||
      connection.expires_at <= Date.now()
    )
      throw new CoordinationError(
        "Enable or renew the provider's background Google connection.",
        409,
      );
    const engine = new CoordinationEngine(env, connection);
    if (route === "provider/file" && request.method === "GET") {
      const query = new URL(request.url).searchParams;
      const row = await env.GOOGLE_SESSIONS.prepare(
        "SELECT id FROM streamlion_coordination_jobs_v1 WHERE id=? AND connection_id=?",
      )
        .bind(query.get("job"), connection.id)
        .first();
      if (!row) throw new CoordinationError("File unavailable.", 404);
      return download(env, engine, row.id, query.get("id"), false);
    }
    if (route === "provider/disconnect" && request.method === "POST") {
      await env.GOOGLE_SESSIONS.batch([
        env.GOOGLE_SESSIONS.prepare(
          "UPDATE streamlion_coordination_connections_v1 SET revoked=1,credentials=? WHERE id=?",
        ).bind(await seal(env, {}, connection.id), connection.id),
        env.GOOGLE_SESSIONS.prepare(
          "UPDATE streamlion_coordination_sessions_v1 SET revoked=1 WHERE job_id IN (SELECT id FROM streamlion_coordination_jobs_v1 WHERE connection_id=?)",
        ).bind(connection.id),
      ]);
      return json({ disconnected: true });
    }
    if (route === "provider/jobs" && request.method === "GET") {
      const snapshot = await engine.google.snapshot();
      const pending = await env.GOOGLE_SESSIONS.prepare(
        "SELECT id,job_id,created_at FROM streamlion_coordination_operations_v1 WHERE connection_id=? AND state='pending'",
      )
        .bind(connection.id)
        .all();
      const mail = await env.GOOGLE_SESSIONS.prepare(
        "SELECT COUNT(*) AS queued,SUM(CASE WHEN o.attempts>=10 THEN 1 ELSE 0 END) AS stalled FROM streamlion_coordination_outbox_v1 o JOIN streamlion_coordination_jobs_v1 j ON j.id=o.job_id WHERE j.connection_id=? AND o.sent_at IS NULL",
      )
        .bind(connection.id)
        .first();
      return json({
        jobs: [...snapshot.heads.values()],
        pending: pending.results,
        mail,
        archives: snapshot.rows[3]
          .slice(1)
          .map((r) => ({ jobId: r[0], fileId: r[2] })),
      });
    }
    if (route === "provider/create" && request.method === "POST") {
      if (!operationID(body.operation))
        throw new CoordinationError("Invalid operation identity.");
      const id = "job-" + body.operation;
      const existing = await env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?",
      )
        .bind(id)
        .first();
      if (existing && existing.connection_id !== connection.id)
        throw new CoordinationError("Operation unavailable.", 409);
      const now = existing?.created_at || Date.now(),
        email = String(body.email || "")
          .trim()
          .toLowerCase();
      const job = newClientJob({
        id,
        provider: connection.google_subject,
        clientEmail: email,
        title: body.title || "",
        now,
      });
      const active = await env.GOOGLE_SESSIONS.prepare(
        "SELECT COUNT(*) AS count FROM streamlion_coordination_jobs_v1 WHERE connection_id=? AND archived=0 AND closed_at IS NULL",
      )
        .bind(connection.id)
        .first();
      if (!existing && active.count >= 100)
        throw new CoordinationError(
          "This pilot workspace supports 100 open requests. Close completed work before creating more.",
          409,
        );
      if (
        existing &&
        (await unseal(env, existing.client_email, "job-email:" + id)) !== email
      )
        throw new CoordinationError("Request identity changed.", 409);
      await env.GOOGLE_SESSIONS.prepare(
        "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM streamlion_coordination_jobs_v1 WHERE id=?)",
      )
        .bind(
          id,
          connection.id,
          id,
          await seal(env, email, "job-email:" + id),
          now,
          id,
        )
        .run();
      await engine.create(body.operation, job);
      const row = await env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?",
      )
        .bind(id)
        .first();
      await invite(env, row);
      return json({
        jobId: id,
        url: env.GOOGLE_AUTH_ORIGIN + "/api/client-portal?job=" + id,
      });
    }
    if (
      [
        "provider/command",
        "provider/retry",
        "provider/invite",
        "provider/upload",
      ].includes(route) &&
      request.method === "POST"
    ) {
      const row = await env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=? AND connection_id=?",
      )
        .bind(body.jobId, connection.id)
        .first();
      if (route === "provider/retry") {
        const operation = await engine.operation(body.operation);
        if (!operation)
          throw new CoordinationError("Operation unavailable.", 404);
        return json(await engine.run(body.operation));
      }
      if (!row) throw new CoordinationError("Job unavailable.", 404);
      if (route === "provider/upload")
        return json(
          await engine.upload(body.operation, row.id, body.file, {
            role: "provider",
          }),
        );
      if (route === "provider/invite") {
        if (row.archived || (row.archive_at && row.archive_at <= Date.now()))
          throw new CoordinationError("Client access has expired.", 409);
        await limited(env, "request-job:" + row.id, 5);
        await invite(env, row);
        return json({ queued: true });
      }
      if (["archive", "activate", "attach"].includes(body.command?.action))
        throw new CoordinationError("System action required.", 403);
      return json(
        await engine.command(body.operation, row.id, body.command, {
          role: "provider",
        }),
      );
    }
    return json({ error: "Unknown provider action." }, 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof CoordinationError
            ? error.message
            : "Coordination is temporarily unavailable. Your original operation is preserved.",
      },
      error instanceof CoordinationError ? error.status : 503,
    );
  }
}
async function download(env, engine, jobId, id, isClient) {
  const job = (await engine.google.snapshot()).heads.get(jobId);
  if (isClient && job?.archiveAt && job.archiveAt <= Date.now())
    throw new CoordinationError("Project access expired.", 401);
  const attachment = job?.attachments.find(
    (a) => a.id === id && (!isClient || a.visibility === "client"),
  );
  if (!attachment) throw new CoordinationError("File unavailable.", 404);
  const file = await engine.google.callMetadata(attachment.driveId);
  if (
    !file ||
    Number(file.size) !== attachment.bytes ||
    Number(file.size) > 512 * 1024
  )
    throw new CoordinationError(
      "Attachment changed. Ask the provider to review the original.",
      409,
    );
  const response = await engine.google.call(
    "https://www.googleapis.com/drive/v3/files/" +
      attachment.driveId +
      "?alt=media",
  );
  return new Response(response.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename*=UTF-8''" + encodeURIComponent(attachment.name),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
