import { getSession, hash } from "./google-auth.js";
import { getExtensionProject } from "./extension-workbook.js";
import { hasPurchase, licenseRequired } from "./purchase-access.js";
import { boundedText } from "./request-body.js";
import {
  paidCreditMode,
  creditAccount,
  creditCapacity,
  expireCreditTurns,
  reserveCreditTurn,
  finishCreditTurn,
} from "./ai-credit-ledger.js";
import {
  AI_LIMITS,
  projectContext,
  streamAnswer,
  synthesize,
  streamSpeech,
  SPEECH_PCM,
  takePhrase,
} from "./ai-providers.js";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });
const settingsReady = (env) =>
  env.ENABLE_AI_PILOT === "true" &&
  env.OPENAI_API_KEY &&
  env.DEEPINFRA_API_KEY &&
  env.GOOGLE_SESSIONS;
// The owner's closed-pilot allowance is cumulative, including failed attempts.
// Raising this ceiling requires a separately authorized rollout.
export const PILOT_CEILING = { attempts: 30, reserveMicros: 1000000 };
export async function expireTurns(db, now = Date.now()) {
  await db
    .prepare(
      "UPDATE streamlion_ai_turns_v1 SET state='failed' WHERE state='reserved' AND created_at < ?",
    )
    .bind(now - 300000)
    .run();
}
export async function reserveTurn(db, subject, id, price, now = Date.now()) {
  // SQLite triggers atomically check both account capacity and shared capacity,
  // then debit credits. No rejected account consumes the global budget.
  const reserved = await db
    .prepare(
      "INSERT INTO streamlion_ai_turns_v1(google_subject,request_id,created_at,price_micros,reserve_micros) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM streamlion_ai_turns_v1) < ? AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_ai_turns_v1) + ? <= ?",
    )
    .bind(
      subject,
      id,
      now,
      price,
      AI_LIMITS.reserveMicros,
      PILOT_CEILING.attempts,
      AI_LIMITS.reserveMicros,
      PILOT_CEILING.reserveMicros,
    )
    .run();
  if (
    !Number.isSafeInteger(reserved.meta?.changes) ||
    reserved.meta.changes < 1
  )
    throw new Error("pilot_exhausted");
  return reserved;
}
export async function finishTurn(db, subject, id, state) {
  return db
    .prepare(
      "UPDATE streamlion_ai_turns_v1 SET state=? WHERE google_subject=? AND request_id=? AND state='reserved'",
    )
    .bind(state, subject, id)
    .run();
}
async function account(db, subject) {
  return db
    .prepare(
      "SELECT w.balance_micros,p.price_micros,p.daily_budget_micros,p.active FROM streamlion_ai_wallets_v1 w JOIN streamlion_ai_policy_v1 p ON p.id=1 WHERE w.google_subject=? AND w.enabled=1",
    )
    .bind(subject)
    .first();
}
export async function handleAI(context) {
  const requestStarted = Date.now();
  const { request, env } = context,
    path = new URL(request.url).pathname;
  if (!["/api/ai/config", "/api/ai/answer"].includes(path))
    return json({ error: "Not found." }, 404);
  if (
    (path.endsWith("/config") && request.method !== "GET") ||
    (path.endsWith("/answer") && request.method !== "POST")
  )
    return json({ error: "Method not allowed." }, 405);
  const creditMode = paidCreditMode(env),
    paid = creditMode !== "disabled";
  // Test payments can exercise fulfillment but can never buy real provider calls.
  if (
    paid &&
    (creditMode !== "live" ||
      env.STREAMLION_AI_COST_APPROVED !== "true" ||
      env.STREAMLION_PAYMENTS_MODE !== "live" ||
      env.STREAMLION_LIVE_PAYMENTS_APPROVED !== "true")
  )
    return path.endsWith("/config")
      ? json({
          enabled: false,
          reason: "credits_not_active",
          billing: "credits",
        })
      : json({ error: "Paid AI credits are not active." }, 503);
  if (!settingsReady(env))
    return path.endsWith("/config")
      ? json({ enabled: false, reason: "pilot_unavailable" })
      : json({ error: "AI pilot is not configured." }, 503);
  // No cross-origin credentialed reads or writes, and no client-chosen origins.
  if (
    new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
    (request.method === "POST" &&
      request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN) ||
    ["cross-site"].includes(request.headers.get("Sec-Fetch-Site"))
  )
    return json({ error: "Open StreamLion to continue." }, 403);
  try {
    const session = await getSession(request, env);
    if (!session)
      return path.endsWith("/config")
        ? json({ enabled: false, reason: "connect_google" })
        : json({ error: "Connect Google before using AI." }, 401);
    if (
      (paid || licenseRequired(env)) &&
      !(await hasPurchase(env, session.google_subject))
    )
      return json({ error: "A StreamLion license is required." }, 402);
    const database = env.GOOGLE_SESSIONS;
    const readAccount = () =>
      paid
        ? creditAccount(database, creditMode, session.google_subject)
        : account(database, session.google_subject);
    const finish = (state) =>
      paid
        ? finishCreditTurn(
            database,
            creditMode,
            session.google_subject,
            input.requestId,
            state,
          )
        : finishTurn(database, session.google_subject, input.requestId, state);
    if (paid) await expireCreditTurns(database, creditMode);
    else await expireTurns(database);
    const wallet = await readAccount();
    const eligible =
      wallet?.active === 1 &&
      wallet.daily_budget_micros >= AI_LIMITS.reserveMicros &&
      (!paid || wallet.price_micros > 0);
    // An opaque preference key, never a session token or raw Google identity.
    const preferenceScope = session.workbook_id
      ? await hash(
          JSON.stringify([
            "ai-preference-v1",
            session.google_subject,
            session.workbook_id,
            ...(paid ? ["paid-credits", creditMode] : []),
          ]),
        )
      : null;
    const totals = paid
      ? await creditCapacity(database, creditMode)
      : await env.GOOGLE_SESSIONS.prepare(
          "SELECT COUNT(*) AS attempts,COALESCE(SUM(reserve_micros),0) AS reserved FROM streamlion_ai_turns_v1",
        ).first();
    const exhausted = paid
      ? totals.reserved + AI_LIMITS.reserveMicros >
          wallet.total_budget_micros ||
        totals.dailyReserved + AI_LIMITS.reserveMicros >
          wallet.daily_budget_micros ||
        totals.dailyAttempts >= wallet.daily_requests
      : totals.attempts >= PILOT_CEILING.attempts ||
        totals.reserved + AI_LIMITS.reserveMicros > PILOT_CEILING.reserveMicros;
    if (path.endsWith("/config")) {
      if (!session.workbook_id)
        return json({ enabled: false, reason: "select_workbook" });
      const quote = {
        preferenceScope,
        ...(paid ? { billing: "credits", creditsUrl: "/api/credits" } : {}),
        ...(wallet
          ? {
              priceMicros: wallet.price_micros,
              balanceMicros: Math.max(0, wallet.balance_micros),
            }
          : {}),
      };
      if (eligible && exhausted)
        return json({
          enabled: false,
          reason: paid ? "credit_capacity" : "pilot_exhausted",
          ...quote,
        });
      if (eligible && wallet.balance_micros < wallet.price_micros)
        return json({ enabled: false, reason: "credits_exhausted", ...quote });
      if (eligible)
        return json({
          enabled: true,
          ...quote,
        });
      const policy = paid
        ? wallet
        : await env.GOOGLE_SESSIONS.prepare(
            "SELECT active,daily_budget_micros FROM streamlion_ai_policy_v1 WHERE id=1",
          ).first();
      return json({
        enabled: false,
        reason: paid
          ? "credits_not_active"
          : !policy?.active
            ? "pilot_paused"
            : policy.daily_budget_micros < AI_LIMITS.reserveMicros
              ? "pilot_unavailable"
              : "account_not_enabled",
        ...quote,
      });
    }
    if (!eligible || !session.workbook_id)
      return json(
        {
          error:
            "AI is not available for this account. Select a Google workbook and check availability.",
        },
        403,
      );
    if (exhausted)
      return json(
        {
          error: paid
            ? "AI usage is temporarily paused. No credits were charged."
            : "The approved AI pilot allowance has been used. No credits were charged.",
        },
        429,
      );
    if (
      !(request.headers.get("Content-Type") || "").startsWith(
        "application/json",
      )
    )
      return json({ error: "Use JSON." }, 415);
    const input = JSON.parse(await boundedText(request, 4096));
    if (
      typeof input.question !== "string" ||
      !input.question.trim() ||
      input.question.length > 500 ||
      typeof input.projectId !== "string" ||
      !/^[\w-]{1,100}$/.test(input.projectId) ||
      typeof input.requestId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(input.requestId) ||
      !["boolean"].includes(typeof input.speech) ||
      (input.audioFormat !== undefined && input.audioFormat !== "pcm_s16le")
    )
      return json({ error: "Check the question and selected project." }, 400);
    if (input.preferenceScope !== preferenceScope)
      return json(
        {
          error:
            "Your Google account or workbook changed. Check AI availability before asking again.",
        },
        409,
      );
    if (input.priceMicros !== wallet.price_micros)
      return json(
        {
          error:
            "The AI credit price changed. Review the updated price before asking.",
        },
        409,
      );
    const prior = paid
      ? await database
          .prepare(
            "SELECT state FROM streamlion_credit_turns_v1 WHERE mode=? AND google_subject=? AND request_id=?",
          )
          .bind(creditMode, session.google_subject, input.requestId)
          .first()
      : await env.GOOGLE_SESSIONS.prepare(
          "SELECT state FROM streamlion_ai_turns_v1 WHERE google_subject=? AND request_id=?",
        )
          .bind(session.google_subject, input.requestId)
          .first();
    if (prior)
      return json(
        {
          error:
            "This request was already submitted. Check the existing answer before asking again.",
        },
        409,
      );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    let streaming = false;
    try {
      const snapshot = await getExtensionProject(
        env,
        { session, bookId: session.workbook_id },
        input.projectId,
      );
      const records = projectContext(snapshot.project, snapshot.notes);
      if (controller.signal.aborted) throw new Error("cancelled");
      try {
        if (paid)
          await reserveCreditTurn(
            database,
            creditMode,
            session.google_subject,
            input.requestId,
            wallet.price_micros,
          );
        else
          await reserveTurn(
            env.GOOGLE_SESSIONS,
            session.google_subject,
            input.requestId,
            wallet.price_micros,
          );
      } catch {
        return json(
          {
            error:
              "AI credits or capacity are unavailable. No credits were charged.",
          },
          429,
        );
      }
      streaming = true;
      let streamController;
      const stream = new TransformStream({
          start(value) {
            streamController = value;
          },
        }),
        writer = stream.writable.getWriter();
      writer.closed.catch(() => controller.abort());
      const stopStream = () =>
        streamController.error(new Error("AI stream stopped."));
      controller.signal.addEventListener("abort", stopStream, { once: true });
      const send = async (data) => {
        if (controller.signal.aborted) throw new Error("cancelled");
        return writer.write(
          new TextEncoder().encode(JSON.stringify(data) + "\n"),
        );
      };
      let textComplete = false,
        speechFailed = false,
        speechCount = 0,
        audioBytes = 0,
        phrase = "",
        speechQueue = Promise.resolve();
      const enqueueSpeech = (text) => {
        if (!input.speech || !text.trim() || speechFailed) return;
        speechCount++;
        speechQueue = speechQueue.then(async () => {
          if (controller.signal.aborted || speechFailed) return;
          try {
            firstSpeechRequestMs ??= Date.now() - started;
            if (input.audioFormat === "pcm_s16le") {
              for await (const audio of streamSpeech(
                env,
                text,
                controller.signal,
              )) {
                audioBytes += Buffer.from(audio, "base64").length;
                if (audioBytes > 3 * SPEECH_PCM.maxBytes)
                  throw new Error("speech_size");
                firstAudioMs ??= Date.now() - started;
                await send({
                  type: "audio",
                  audio,
                  format: "pcm_s16le",
                  sampleRate: SPEECH_PCM.sampleRate,
                });
              }
            } else {
              // Installed older clients still require complete, decodable WAV files.
              const audio = await synthesize(env, text, controller.signal);
              firstAudioMs ??= Date.now() - started;
              await send({ type: "audio", audio });
            }
          } catch {
            if (controller.signal.aborted) return;
            speechFailed = true;
            await send({
              type: "speech_error",
              message:
                "Hosted voice is unavailable. Your text answer remains available.",
            });
          }
        });
        // Attach immediately: a disconnected browser must not create an unhandled rejection.
        speechQueue.catch(() => controller.abort());
      };
      const started = Date.now();
      let firstTextMs = null,
        firstAudioMs = null,
        firstSpeechRequestMs = null;
      const work = (async () => {
        try {
          await send({
            type: "start",
            priceMicros: wallet.price_micros,
            source: `Google workbook · read ${snapshot.destination.asOf}`,
          });
          for await (const delta of streamAnswer(
            env,
            input.question.trim(),
            records,
            controller.signal,
          )) {
            firstTextMs ??= Date.now() - started;
            await send({ type: "text", delta });
            phrase += delta;
            if (speechCount < 5) {
              const [ready, rest] = takePhrase(phrase);
              if (ready) {
                phrase = rest;
                enqueueSpeech(ready);
              }
            }
          }
          await finish("complete");
          textComplete = true;
          const balanceMicros = Math.max(
            0,
            (await readAccount())?.balance_micros || 0,
          );
          await send({ type: "text_done", balanceMicros });
          enqueueSpeech(phrase);
          await speechQueue;
          await send({
            type: "done",
            timings: {
              firstTextMs,
              firstAudioMs,
              firstSpeechRequestMs,
              setupMs: started - requestStarted,
              requestFirstTextMs:
                firstTextMs == null
                  ? null
                  : started - requestStarted + firstTextMs,
              requestFirstAudioMs:
                firstAudioMs == null
                  ? null
                  : started - requestStarted + firstAudioMs,
              requestTotalMs: Date.now() - requestStarted,
              totalMs: Date.now() - started,
            },
            balanceMicros,
          });
        } catch {
          controller.signal.removeEventListener("abort", stopStream);
          controller.abort();
          await speechQueue.catch(() => {});
          if (!textComplete) await finish("failed");
          const errorFrame = {
            type: "error",
            message: textComplete
              ? "The answer completed, but playback was interrupted."
              : "AI did not finish. Any partial text is incomplete; your credits were returned.",
          };
          if (!request.signal.aborted) {
            const errorTimeout = setTimeout(stopStream, 1000);
            try {
              await writer.write(
                new TextEncoder().encode(JSON.stringify(errorFrame) + "\n"),
              );
            } catch {
              /* Disconnected or timed-out stream. */
            } finally {
              clearTimeout(errorTimeout);
            }
          }
        } finally {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", stopStream);
          request.signal.removeEventListener("abort", abort);
          await writer.close().catch(() => {});
        }
      })();
      context.waitUntil?.(work);
      // writer backpressure ties delivery to the browser; a canceled reader aborts providers.
      return new Response(stream.readable, {
        headers: { ...headers, "Content-Type": "application/x-ndjson" },
      });
    } finally {
      if (!streaming) {
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", abort);
      }
    }
  } catch (error) {
    // Never return upstream bodies, exception strings, keys or project content.
    return json(
      {
        error:
          error.status === 404
            ? "That project is unavailable in the selected workbook."
            : "AI is unavailable. Check your Google connection; no new provider request was started.",
      },
      [400, 413, 404].includes(error.status)
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 503,
    );
  }
}
