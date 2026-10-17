import { getSession, hash, seal, unseal } from "./google-auth.js";
import { hasPurchase, paymentMode } from "./purchase-access.js";
import { sharedWallet } from "./shared-credits.js";
import { base64urlBytes } from "./base64.js";
import { boundedText } from "./request-body.js";
import {
  BRIEF_QA,
  briefQAWindow,
  briefQAPolicy,
  briefQACapacity,
  BRIEF_QA_RESERVATION,
} from "./brief-qa.js";
import {
  BRIEF_LIMITS,
  BRIEF_MODEL,
  BRIEF_SCHEMA,
  BRIEF_INSTRUCTIONS,
  validateBriefResult,
} from "../src/brief-import-contract.js";

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const idOK = (id) =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const approved = (env) => {
  try {
    return (
      env.ENABLE_BRIEF_IMPORT === "true" &&
      env.STREAMLION_BRIEF_IMPORT_COST_APPROVED === "true" &&
      env.STREAMLION_PAYMENTS_MODE === "live" &&
      env.STREAMLION_LIVE_PAYMENTS_APPROVED === "true" &&
      env.OPENAI_API_KEY &&
      env.GOOGLE_SESSIONS &&
      base64urlBytes(env.GOOGLE_TOKEN_ENCRYPTION_KEY || "").length === 32
    );
  } catch {
    return false;
  }
};
const jobContext = (mode, subject, id) =>
  JSON.stringify(["brief-result-v1", mode, subject, id]);

export async function extractBrief(env, input, fetcher = fetch) {
  // One request, no automatic inference retries and no paid tools/file storage.
  const signal = AbortSignal.timeout(BRIEF_LIMITS.timeoutMs);
  const body = JSON.stringify({
    model: BRIEF_MODEL,
    service_tier: "default",
    store: false,
    reasoning: { effort: "none" },
    max_output_tokens: BRIEF_LIMITS.outputTokens,
    instructions: BRIEF_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: JSON.stringify({
          source: input.sourceName,
          brief: input.text,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "streamlion_project",
        strict: true,
        schema: BRIEF_SCHEMA,
      },
    },
  });
  if (new TextEncoder().encode(body).byteLength > 65536)
    throw new Error("request_size");
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    redirect: "manual",
    signal,
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("provider_unavailable");
  }
  const data = JSON.parse(
    await boundedText(response, BRIEF_LIMITS.responseBytes),
  );
  if (data.status !== "completed" || data.error || data.incomplete_details)
    throw new Error("provider_incomplete");
  const content = (data.output || []).flatMap((item) => item.content || []);
  if (content.some((item) => item.type === "refusal"))
    throw new Error("provider_refusal");
  const text = content
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
  return validateBriefResult(text);
}

async function expire(db, mode, subject, now) {
  // Stale jobs are never run again. Failed attempts still count against budgets.
  await db
    .prepare(
      "UPDATE streamlion_brief_jobs_v1 SET state='failed' WHERE mode=? AND google_subject=? AND state='pending' AND created_at<?",
    )
    .bind(mode, subject, now - BRIEF_LIMITS.staleMs)
    .run();
  await db
    .prepare(
      "UPDATE streamlion_brief_jobs_v1 SET result=NULL WHERE mode=? AND google_subject=? AND state='complete' AND result IS NOT NULL AND expires_at<=?",
    )
    .bind(mode, subject, now)
    .run();
}
async function jobReply(env, row, scope, now) {
  if (row.scope !== scope)
    return reply(
      {
        error:
          "Your account or workbook changed. Return to the original workspace to recover this brief.",
      },
      409,
    );
  if (row.state === "failed")
    return reply({
      state: "failed",
      error:
        "The brief could not be prepared. Reserved credits were returned; your draft is unchanged.",
    });
  if (row.state === "pending")
    return reply({ state: "pending", requestId: row.request_id }, 202);
  if (!row.result || row.expires_at <= now)
    return reply({
      state: "expired",
      error:
        "This result expired after 24 hours. Check your saved draft before preparing another brief.",
    });
  return reply({
    state: "complete",
    requestId: row.request_id,
    priceMicros: row.price_micros,
    project: await unseal(
      env,
      row.result,
      jobContext(row.mode, row.google_subject, row.request_id),
    ),
  });
}

export async function handleBriefImport(
  context,
  { fetcher = fetch, now = Date.now } = {},
) {
  const { request, env } = context,
    url = new URL(request.url),
    route = url.pathname.split("/").pop();
  const config = route === "config",
    result = route === "result",
    prepare = route === "prepare";
  if (!config && !result && !prepare)
    return reply({ error: "Not found." }, 404);
  if (request.method !== (prepare ? "POST" : "GET"))
    return reply({ error: "Method not allowed." }, 405);
  if (
    url.origin !== env.GOOGLE_AUTH_ORIGIN ||
    request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (prepare && request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
  )
    return reply({ error: "Open StreamLion to continue." }, 403);
  // Recovery remains available after pausing the feature; new calls stay closed.
  const window = briefQAWindow(env);
  if (!result && !approved(env) && !window)
    return config
      ? reply({ enabled: false, reason: "not_open" })
      : reply(
          {
            error:
              "Brief preparation is not open. Use manual entry or your ChatGPT account.",
          },
          503,
        );
  try {
    const mode = paymentMode(env);
    if (!env.GOOGLE_SESSIONS || !["test", "live"].includes(mode))
      throw new Error("configuration");
    const session = await getSession(request, env);
    if (!session)
      return config
        ? reply({ enabled: false, reason: "sign_in" })
        : reply(
            { error: "Sign in to the original Google account to continue." },
            401,
          );
    const subject = session.google_subject,
      db = env.GOOGLE_SESSIONS,
      timestamp = now();
    const qa = !result && !approved(env);
    if (qa && window.subject !== subject)
      return config
        ? reply({ enabled: false, reason: "not_open" })
        : reply(
            { error: "Brief QA is restricted to its approved owner." },
            403,
          );
    if (qa && (timestamp < window.start || timestamp >= window.until))
      return config
        ? reply({ enabled: false, reason: "qa_expired" })
        : reply(
            {
              error:
                "The owner QA window is not active. Recover any existing brief.",
            },
            403,
          );
    const scope = await hash(
      JSON.stringify([
        "brief-scope-v1",
        mode,
        subject,
        session.workbook_id || "",
      ]),
    );
    await expire(db, mode, subject, timestamp);
    const find = (id) =>
      db
        .prepare(
          "SELECT * FROM streamlion_brief_jobs_v1 WHERE mode=? AND google_subject=? AND request_id=?",
        )
        .bind(mode, subject, id)
        .first();
    if (result) {
      const id = url.searchParams.get("id");
      if (!idOK(id)) return reply({ error: "Invalid brief reference." }, 400);
      const row = await find(id);
      return row
        ? jobReply(env, row, scope, timestamp)
        : reply(
            {
              error:
                "No brief was found for this account. Return to the account that prepared it.",
            },
            404,
          );
    }
    if (!(await hasPurchase(env, subject)))
      return config
        ? reply({ enabled: false, reason: "license_required" })
        : reply({ error: "A StreamLion license is required." }, 402);
    const policy = await db
      .prepare("SELECT * FROM streamlion_brief_policy_v1 WHERE mode=?")
      .bind(mode)
      .first();
    if (
      !policy?.active ||
      policy.reserve_micros < 100000 ||
      policy.price_micros < policy.reserve_micros ||
      (qa && !briefQAPolicy(policy))
    )
      return config
        ? reply({ enabled: false, reason: "not_open" })
        : reply({ error: "Brief preparation is paused." }, 503);
    const quoteKey = await hash(
      JSON.stringify([
        BRIEF_MODEL,
        BRIEF_LIMITS,
        policy,
        ...(qa ? [window.start, window.until] : []),
      ]),
    );
    const funding = await sharedWallet(db, mode, subject);
    const capacity = qa ? await briefQACapacity(db) : null;
    if (config && qa && !capacity.available)
      return reply({ enabled: false, reason: "qa_exhausted" });
    const canPrepare =
      !funding.hold &&
      funding.available >= policy.price_micros &&
      (!qa ||
        (funding.promotional === 0 && funding.purchased >= BRIEF_QA.price));
    if (config)
      return reply({
        enabled: true,
        scope,
        quoteKey,
        priceMicros: policy.price_micros,
        balanceMicros: funding.available,
        canPrepare,
        maxCharacters: BRIEF_LIMITS.characters,
        ...(qa
          ? {
              ownerQA: {
                attemptsRemaining: capacity.remaining,
                expiresAt: window.expiresAt,
              },
            }
          : {}),
      });
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ error: "Use JSON." }, 415);
    let input;
    try {
      input = JSON.parse(await boundedText(request, BRIEF_LIMITS.requestBytes));
    } catch (error) {
      return reply(
        { error: "Use a brief of up to 6,000 characters." },
        error.status || 400,
      );
    }
    if (
      !idOK(input.requestId) ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > BRIEF_LIMITS.characters ||
      typeof input.sourceName !== "string" ||
      input.sourceName.length > 200 ||
      /[\x00-\x1f\x7f]/.test(input.sourceName)
    )
      return reply(
        { error: "Choose a readable PDF or paste up to 6,000 characters." },
        400,
      );
    if (input.scope !== scope)
      return reply(
        {
          error: "Your account or workbook changed. Check availability again.",
        },
        409,
      );
    const fingerprint = await hash(
      JSON.stringify([input.text, input.sourceName]),
    );
    const prior = await find(input.requestId);
    if (prior) {
      if (prior.input_hash !== fingerprint)
        return reply(
          { error: "This brief reference already belongs to different text." },
          409,
        );
      return jobReply(env, prior, scope, timestamp);
    }
    // Recovery of the same request does not require unused budget or funds.
    // Only a genuinely new reservation is blocked by exhaustion.
    if (qa && !capacity.available)
      return reply(
        {
          error:
            "The three-attempt owner QA budget is exhausted. Recover any existing brief.",
        },
        429,
      );
    if (qa && !canPrepare)
      return reply(
        {
          error:
            "Owner QA requires the approved existing test-wallet funding. No credits were charged.",
        },
        429,
      );
    if (
      input.quoteKey !== quoteKey ||
      input.priceMicros !== policy.price_micros
    )
      return reply(
        {
          error:
            "The price or processing policy changed. Check availability and review the new price.",
        },
        409,
      );
    try {
      const reserved = await db
        .prepare(
          `INSERT INTO streamlion_brief_jobs_v1(mode,google_subject,request_id,scope,input_hash,quote_key,price_micros,reserve_micros,promotional,purchased,created_at,expires_at)
        SELECT ?,?,?,?,?,?,p.price_micros,p.reserve_micros,MIN(p.price_micros,COALESCE(w.balance_micros,0)),p.price_micros-MIN(p.price_micros,COALESCE(w.balance_micros,0)),?,?
        FROM streamlion_brief_policy_v1 p LEFT JOIN streamlion_promotional_wallets_v1 w ON w.mode=p.mode AND w.google_subject=? WHERE p.mode=? AND p.price_micros=? AND p.reserve_micros=?` +
            (qa ? BRIEF_QA_RESERVATION : ""),
        )
        .bind(
          mode,
          subject,
          input.requestId,
          scope,
          fingerprint,
          quoteKey,
          timestamp,
          timestamp + BRIEF_LIMITS.retentionMs,
          subject,
          mode,
          policy.price_micros,
          policy.reserve_micros,
        )
        .run();
      if (reserved.meta?.changes !== 1) throw new Error("policy_changed");
    } catch {
      const racing = await find(input.requestId);
      if (racing && racing.input_hash === fingerprint)
        return jobReply(env, racing, scope, timestamp);
      return reply(
        {
          error:
            "Credits or processing capacity are unavailable. No new credits were charged. Recover any pending brief first.",
        },
        429,
      );
    }
    const run = async () => {
      try {
        if (qa) {
          const current = briefQAWindow(env);
          const currentPolicy = await db
            .prepare(
              "SELECT * FROM streamlion_brief_policy_v1 WHERE mode='test'",
            )
            .first();
          const currentSession = await getSession(request, env);
          const licensed = await hasPurchase(env, subject);
          if (
            !current ||
            current.subject !== subject ||
            current.start !== window.start ||
            current.until !== window.until ||
            now() < current.start ||
            now() >= current.until ||
            !briefQAPolicy(currentPolicy) ||
            !licensed ||
            currentSession?.google_subject !== subject ||
            currentSession.workbook_id !== session.workbook_id
          )
            throw new Error("qa_permission_changed");
        }
        const project = await extractBrief(env, input, fetcher);
        const encrypted = await seal(
          env,
          project,
          jobContext(mode, subject, input.requestId),
        );
        await db
          .prepare(
            "UPDATE streamlion_brief_jobs_v1 SET state='complete',result=? WHERE mode=? AND google_subject=? AND request_id=? AND state='pending'",
          )
          .bind(encrypted, mode, subject, input.requestId)
          .run();
      } catch {
        // Atomic, idempotent refund; no raw source, credentials or provider errors in logs.
        await db
          .prepare(
            "UPDATE streamlion_brief_jobs_v1 SET state='failed' WHERE mode=? AND google_subject=? AND request_id=? AND state='pending'",
          )
          .bind(mode, subject, input.requestId)
          .run();
      }
      return jobReply(env, await find(input.requestId), scope, now());
    };
    const task = run();
    context.waitUntil?.(
      task.then(
        () => {},
        () => {},
      ),
    );
    return await task;
  } catch {
    return config
      ? reply({ enabled: false, reason: "unavailable" })
      : reply(
          {
            error:
              "Brief preparation is unavailable. Your draft is unchanged; recover the existing brief before trying again.",
          },
          503,
        );
  }
}
