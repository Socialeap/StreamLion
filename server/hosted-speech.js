import { getSession, hash, seal, unseal } from "./google-auth.js";
import { hasPurchase, paymentMode } from "./purchase-access.js";
import { getExtensionProject } from "./extension-workbook.js";
import { boundedText, RequestBodyError } from "./request-body.js";
import { synthesize } from "./ai-providers.js";
import { answerProjectQuestion } from "../src/project-answers.js";
import { filterPrivateTexts } from "../src/privacy-filter.js";

export const SPEECH_LIMITS = {
  chars: 1200,
  quoteMs: 60000,
  timeoutMs: 20000,
  staleMs: 300000,
};
const reply = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export const speechApproved = (env) =>
  env.STREAMLION_HOSTED_SPEECH_APPROVED === "true" &&
  env.STREAMLION_LIVE_PAYMENTS_APPROVED === "true" &&
  paymentMode(env) === "live" &&
  env.STREAMLION_AI_CREDITS_MODE === "live" &&
  Boolean(env.DEEPINFRA_API_KEY && env.GOOGLE_SESSIONS);
export const speechPrice = (cost) => {
  if (!Number.isSafeInteger(cost) || cost <= 0 || cost > 1000000)
    throw Error("speech_policy");
  return Math.ceil((cost * 130) / 100);
};
// Text is rebuilt from the authorized workbook; callers cannot submit arbitrary TTS text.
export function speechText(project, question, topicId) {
  const result = answerProjectQuestion(project, question, topicId);
  if (
    result.kind !== "answer" ||
    result.answers.some((a) => a.topic === "access")
  )
    throw Error("speech_access");
  const text = result.answers.map((a) => a.text).join(". ");
  if (!text.trim() || text.length > SPEECH_LIMITS.chars)
    throw Error("speech_length");
  const access = String(project.accessInstructions || "");
  const secrets = [access, ...(access.match(/\b\d{3,12}\b/g) || [])].filter(
    Boolean,
  );
  if (
    filterPrivateTexts([text], {
      secrets,
      repeatSecrets: true,
      maxChars: SPEECH_LIMITS.chars,
    }).removedSecrets
  )
    throw Error("speech_access");
  return text;
}
export async function reserveSpeech(
  db,
  subject,
  id,
  scope,
  inputHash,
  price,
  cost,
  now,
) {
  return db
    .prepare(
      "INSERT INTO streamlion_speech_turns_v1(mode,google_subject,request_id,scope,input_hash,price_micros,reserve_micros,created_at) VALUES('live',?,?,?,?,?,?,?)",
    )
    .bind(subject, id, scope, inputHash, price, cost, now)
    .run();
}
export async function finishSpeech(db, subject, id, state) {
  return db
    .prepare(
      "UPDATE streamlion_speech_turns_v1 SET state=? WHERE mode='live' AND google_subject=? AND request_id=? AND state='reserved'",
    )
    .bind(state, subject, id)
    .run();
}
export async function expireSpeech(db, subject, now) {
  return db
    .prepare(
      "UPDATE streamlion_speech_turns_v1 SET state='failed' WHERE mode='live' AND google_subject=? AND state='reserved' AND created_at<?",
    )
    .bind(subject, now - SPEECH_LIMITS.staleMs)
    .run();
}
export function speechAudio(audio) {
  if (
    typeof audio !== "string" ||
    audio.length > 3 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)
  )
    throw Error("speech_audio");
  const bytes = Buffer.from(audio, "base64");
  if (
    bytes.length < 44 ||
    bytes.length > 2 * 1024 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    throw Error("speech_audio");
  let frameSize = 0,
    dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (start + size > bytes.length) throw Error("speech_audio");
    if (kind === "fmt ") {
      if (size < 16) throw Error("speech_audio");
      const format = bytes.readUInt16LE(start),
        channels = bytes.readUInt16LE(start + 2);
      const rate = bytes.readUInt32LE(start + 4),
        bits = bytes.readUInt16LE(start + 14);
      if (
        ![1, 3].includes(format) ||
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 192000 ||
        !(format === 3 ? [32] : [8, 16, 24, 32]).includes(bits)
      )
        throw Error("speech_audio");
      frameSize = (channels * bits) / 8;
      if (
        bytes.readUInt16LE(start + 12) !== frameSize ||
        bytes.readUInt32LE(start + 8) !== rate * frameSize
      )
        throw Error("speech_audio");
    }
    if (kind === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  if (!frameSize || !dataSize || dataSize % frameSize)
    throw Error("speech_audio");
  return bytes;
}
export async function handleSpeech({ request, env }, dependencies = {}) {
  const {
    now = Date.now,
    readProject = getExtensionProject,
    generate = synthesize,
  } = dependencies;
  const route = new URL(request.url).pathname.split("/").pop();
  if (!["config", "quote", "speak", "status"].includes(route))
    return reply({ error: "Not found." }, 404);
  if (
    request.method !== (["config", "status"].includes(route) ? "GET" : "POST")
  )
    return reply({ error: "Method not allowed." }, 405);
  if (
    new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
    request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (request.method === "POST" &&
      request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
  )
    return reply({ error: "Open StreamLion to continue." }, 403);
  // Recovery reads remain possible after a pause; new synthesis always fails closed.
  if (route !== "status" && !speechApproved(env))
    return route === "config"
      ? reply({ enabled: false, reason: "not_open" })
      : reply(
          {
            error:
              "Hosted speech is not open. Device voice and text remain available.",
          },
          503,
        );
  try {
    const db = env.GOOGLE_SESSIONS;
    if (!db) throw Error("configuration");
    const stamp = await db
      .prepare(
        "SELECT version FROM streamlion_speech_schema_v1 WHERE version=1",
      )
      .first();
    const markers = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('streamlion_speech_policy_v1','streamlion_speech_turns_v1','streamlion_speech_schema_v1','idx_streamlion_speech_pending','idx_streamlion_speech_capacity','streamlion_speech_reserve_v1','streamlion_speech_debit_v1','streamlion_speech_transition_v1','streamlion_speech_refund_v1')",
      )
      .first();
    if (stamp?.version !== 1 || markers?.n !== 9) throw Error("speech_schema");
    const session = await getSession(request, env);
    if (!session)
      return route === "config"
        ? reply({ enabled: false, reason: "sign_in" })
        : reply({ error: "Sign in to continue." }, 401);
    if (!session.workbook_id)
      return reply(
        { enabled: false, reason: "select_workbook" },
        route === "config" ? 200 : 409,
      );
    const subject = session.google_subject;
    const scope = await hash(
      JSON.stringify(["speech-v1", subject, session.workbook_id]),
    );
    await expireSpeech(db, subject, now());
    if (route === "status") {
      const id = new URL(request.url).searchParams.get("requestId");
      if (!/^[0-9a-f-]{36}$/.test(id || ""))
        return reply({ error: "Invalid request." }, 400);
      if (new URL(request.url).searchParams.get("scope") !== scope)
        return reply(
          { error: "Return to the original account and workbook." },
          409,
        );
      const row = await db
        .prepare(
          "SELECT state,scope,price_micros FROM streamlion_speech_turns_v1 WHERE mode='live' AND google_subject=? AND request_id=?",
        )
        .bind(subject, id)
        .first();
      if (!row) return reply({ state: "not_found", scope }, 404);
      if (row.scope !== scope)
        return reply({ error: "Return to the original workspace." }, 409);
      return reply({ state: row.state, priceMicros: row.price_micros });
    }
    if (!(await hasPurchase(env, subject)))
      return reply({ error: "A StreamLion purchase is required." }, 402);
    const policy = await db
      .prepare("SELECT * FROM streamlion_speech_policy_v1 WHERE mode='live'")
      .first();
    if (policy?.active !== 1)
      return route === "config"
        ? reply({ enabled: false, reason: "policy_paused" })
        : reply({ error: "Hosted speech is paused." }, 503);
    const price = speechPrice(policy.cost_micros);
    if (
      policy.daily_requests <= 0 ||
      policy.daily_budget_micros < policy.cost_micros ||
      policy.total_budget_micros < policy.cost_micros
    )
      throw Error("speech_policy");
    const wallet = await db
      .prepare(
        "SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode='live' AND google_subject=?",
      )
      .bind(subject)
      .first();
    if (route === "config")
      return reply({
        enabled: true,
        scope,
        priceMicros: price,
        balanceMicros: Math.max(0, wallet?.balance_micros || 0),
        maxChars: SPEECH_LIMITS.chars,
      });
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ error: "Use JSON." }, 415);
    const input = JSON.parse(await boundedText(request, 8192));
    let details;
    if (route === "quote") {
      if (
        typeof input.question !== "string" ||
        input.question.length > 500 ||
        typeof input.projectId !== "string" ||
        !/^[\w-]{1,100}$/.test(input.projectId) ||
        (input.topicId !== undefined && typeof input.topicId !== "string")
      )
        return reply(
          { error: "Check the selected project and question." },
          400,
        );
      details = {
        projectId: input.projectId,
        question: input.question,
        topicId: input.topicId,
      };
    } else {
      if (
        typeof input.quoteToken !== "string" ||
        typeof input.requestId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(input.requestId)
      )
        return reply({ error: "Review a fresh speech quote." }, 400);
      try {
        details = await unseal(env, input.quoteToken, "speech-quote-v1");
      } catch {
        return reply({ error: "Speech quote is invalid." }, 409);
      }
      if (
        details.scope !== scope ||
        details.expiresAt <= now() ||
        details.expiresAt > now() + SPEECH_LIMITS.quoteMs ||
        details.priceMicros !== price ||
        details.costMicros !== policy.cost_micros
      )
        return reply(
          { error: "Speech quote changed or expired. Review a new quote." },
          409,
        );
      const prior = await db
        .prepare(
          "SELECT state FROM streamlion_speech_turns_v1 WHERE mode='live' AND google_subject=? AND request_id=?",
        )
        .bind(subject, input.requestId)
        .first();
      if (prior)
        return reply(
          {
            error:
              "Request already submitted. Check its status; no audio is generated again.",
            state: prior.state,
          },
          409,
        );
    }
    const snapshot = await readProject(
      env,
      { session, bookId: session.workbook_id },
      details.projectId,
    );
    let text;
    try {
      text = speechText(snapshot.project, details.question, details.topicId);
    } catch {
      return reply(
        {
          error:
            "This answer needs device speech. Access details, secrets and long answers are not sent to hosted speech.",
        },
        422,
      );
    }
    const inputHash = await hash(
      JSON.stringify([scope, details.projectId, text]),
    );
    if (route === "quote") {
      const expiresAt = now() + SPEECH_LIMITS.quoteMs;
      const quoteToken = await seal(
        env,
        {
          ...details,
          scope,
          inputHash,
          priceMicros: price,
          costMicros: policy.cost_micros,
          expiresAt,
        },
        "speech-quote-v1",
      );
      return reply({
        quoteToken,
        text,
        priceMicros: price,
        balanceMicros: Math.max(0, wallet?.balance_micros || 0),
        expiresAt,
      });
    }
    if (details.inputHash !== inputHash)
      return reply(
        { error: "The saved answer changed. Review a new quote." },
        409,
      );
    // Check again after the Google read. Trigger independently verifies policy, funds and capacity atomically.
    if (!speechApproved(env))
      return reply({ error: "Hosted speech is paused." }, 503);
    if (details.expiresAt <= now())
      return reply({ error: "Speech quote expired. Review a new quote." }, 409);
    try {
      await reserveSpeech(
        db,
        subject,
        input.requestId,
        scope,
        inputHash,
        price,
        policy.cost_micros,
        now(),
      );
    } catch (error) {
      // An insert acknowledgement can be lost after committing. Never report
      // that no charge exists until this request's ledger has been checked.
      const prior = await db
        .prepare(
          "SELECT state FROM streamlion_speech_turns_v1 WHERE mode='live' AND google_subject=? AND request_id=?",
        )
        .bind(subject, input.requestId)
        .first();
      if (prior)
        return reply(
          {
            error:
              "Request already submitted. Check its status; no audio is generated again.",
            state: prior.state,
          },
          409,
        );
      // Only the atomic capacity trigger definitively rejects a new insert.
      // Storage/transport errors remain uncertain and reach the 503 handler.
      if (!String(error?.message || error).includes("speech_capacity"))
        throw error;
      return reply(
        {
          error:
            "Speech credits or capacity are unavailable. No new speech charge was made.",
        },
        409,
      );
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, SPEECH_LIMITS.timeoutMs);
    try {
      if (request.signal.aborted) throw Error("aborted");
      const audio = await generate(
        env,
        text,
        controller.signal,
        (url, options) => fetch(url, { ...options, redirect: "manual" }),
      );
      const bytes = speechAudio(audio);
      if (controller.signal.aborted) throw Error("aborted");
      const response = new Response(bytes, {
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Speech-Request-ID": input.requestId,
          "X-Speech-Price-Micros": String(price),
        },
      });
      const finished = await finishSpeech(
        db,
        subject,
        input.requestId,
        "complete",
      );
      if (finished.meta.changes !== 1) throw Error("speech_state");
      return response;
    } catch {
      const refunded = await finishSpeech(
        db,
        subject,
        input.requestId,
        "failed",
      );
      if (refunded.meta.changes !== 1)
        return reply(
          {
            error:
              "Speech status is uncertain. Check this request before trying again.",
          },
          503,
        );
      return reply(
        {
          error:
            "Speech could not be prepared. Reserved credits were returned. Your text is unchanged.",
        },
        502,
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  } catch (error) {
    if (error instanceof RequestBodyError)
      return reply({ error: "Speech request is too large." }, error.status);
    if (error instanceof SyntaxError)
      return reply({ error: "Use a valid JSON speech request." }, 400);
    return reply(
      {
        error: "Hosted speech is unavailable. Keep using device voice or text.",
      },
      503,
    );
  }
}
