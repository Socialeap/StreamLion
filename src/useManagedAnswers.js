import { useEffect, useRef, useState } from "react";
import {
  createAudioPlayer,
  readAnswerStream,
  demoAnswer,
} from "./managed-ai.js";
const preferenceKey = (scope) => `streamlion-ai-choice-v1:${scope}`;
function savedChoice(scope) {
  if (!scope) return null;
  try {
    const choice = JSON.parse(
      window.localStorage.getItem(preferenceKey(scope)),
    );
    if (
      choice?.mode === "free" ||
      (choice?.mode === "ai" &&
        Number.isSafeInteger(choice.priceMicros) &&
        choice.priceMicros >= 0)
    )
      return { ...choice, scope };
  } catch {
    /* Storage is optional; consent is still required in this session. */
  }
  return null;
}
export default function useManagedAnswers({
  project,
  source,
  onBusy,
  onResult,
  onMessage,
}) {
  const demo = Boolean(
    import.meta.env?.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("ai-demo") === "1",
  );
  const [config, setConfig] = useState(
    demo ? { enabled: true, priceMicros: 0, balanceMicros: 0 } : null,
  );
  const [choice, setChoice] = useState(
    demo ? { mode: "ai", priceMicros: 0 } : null,
  );
  const [configCheck, setConfigCheck] = useState({
    pending: false,
    message: "",
  });
  const choiceRef = useRef(choice);
  const [busy, setBusy] = useState(false),
    [audioPlaying, setAudioPlaying] = useState(false);
  const mode = demo
    ? choice?.mode
    : source !== "google"
      ? "free"
      : choice?.scope === config?.preferenceScope
        ? choice?.mode
        : null;
  const active = Boolean(
    config?.enabled &&
    mode === "ai" &&
    choice?.priceMicros === config.priceMicros,
  );
  function setActive(value) {
    const next = {
      scope: config?.preferenceScope,
      mode: value ? "ai" : "free",
      priceMicros: config?.priceMicros,
    };
    choiceRef.current = next;
    setChoice(next);
    if (next.scope) {
      try {
        window.localStorage.setItem(
          preferenceKey(next.scope),
          JSON.stringify(next),
        );
      } catch {
        /* A session-only choice is safe when storage is unavailable. */
      }
    }
  }
  const lifetime = useRef(null);
  const configRequest = useRef(0);
  const configFlight = useRef(null);
  const turn = useRef(null),
    callbacks = useRef({ onBusy, onResult, onMessage });
  callbacks.current = { onBusy, onResult, onMessage };
  function cancel() {
    const current = turn.current;
    turn.current = null;
    if (current) {
      clearTimeout(current.flushTimer);
      current.controller.abort();
      current.player?.stop();
      window.speechSynthesis?.cancel();
    }
    setBusy(false);
    setAudioPlaying(false);
    callbacks.current.onBusy?.(false);
    if (current && !demo) refresh();
  }
  async function loadConfig(owner, manual = false) {
    // Repeated taps share the current read; checking availability never buys an answer.
    if (configFlight.current?.owner === owner) return;
    const requestId = ++configRequest.current;
    const controller = new AbortController();
    const flight = { owner, controller };
    configFlight.current = flight;
    setConfigCheck({
      pending: true,
      message: manual ? "Checking AI availability…" : "",
    });
    const current = () =>
      lifetime.current === owner &&
      !owner.signal.aborted &&
      requestId === configRequest.current;
    let rejectStopped,
      timedOut = false;
    const stopped = new Promise((_, reject) => {
      rejectStopped = reject;
    });
    const abort = () => {
      controller.abort();
      rejectStopped(
        new DOMException("Availability check stopped", "AbortError"),
      );
    };
    owner.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, 8000);
    try {
      const { response, data } = await Promise.race([
        (async () => {
          const response = await fetch("/api/ai/config", {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          return { response, data: await response.json() };
        })(),
        stopped,
      ]);
      if (
        !response.ok ||
        typeof data.enabled !== "boolean" ||
        (data.enabled &&
          (!/^[A-Za-z0-9_-]{43}$/.test(data.preferenceScope || "") ||
            !Number.isSafeInteger(data.priceMicros) ||
            data.priceMicros < 0 ||
            !Number.isSafeInteger(data.balanceMicros) ||
            data.balanceMicros < 0))
      )
        throw new Error("config_unavailable");
      if (current()) {
        setConfig(data);
        setConfigCheck({
          pending: false,
          message: manual
            ? data.enabled
              ? "AI is available. This check used no credits."
              : data.reason === "pilot_paused"
                ? "Check complete — the administrator pause is still active."
                : "Check complete — AI is still unavailable."
            : "",
        });
        // Availability must not erase a user's choice when the operator pauses AI.
        if (
          data.preferenceScope &&
          choiceRef.current?.scope !== data.preferenceScope
        ) {
          const next = savedChoice(data.preferenceScope);
          choiceRef.current = next;
          setChoice(next);
        }
      }
    } catch {
      if (current()) {
        setConfig({ enabled: false, reason: "status_unavailable" });
        setConfigCheck({
          pending: false,
          error: true,
          message: timedOut
            ? "The availability check timed out. Try again."
            : "Could not check AI availability. Check your connection and try again.",
        });
      }
    } finally {
      clearTimeout(timer);
      owner.signal.removeEventListener("abort", abort);
      if (configFlight.current === flight) configFlight.current = null;
    }
  }
  function refresh(manual = false) {
    const owner = lifetime.current;
    if (!owner || source !== "google" || demo) return;
    return loadConfig(owner, manual);
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (!demo && source === "google") loadConfig(controller);
    const hide = () => {
      if (document.hidden && turn.current) {
        cancel();
        callbacks.current.onMessage(
          "AI stopped when the app left the screen. Check credits before asking again.",
        );
      }
      if (!document.hidden && !turn.current && !demo && source === "google")
        loadConfig(controller);
    };
    const leave = () => cancel();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      controller.abort();
      lifetime.current = null;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      cancel();
    };
  }, []);
  async function ask(question, speech) {
    // A rapid second tap must not cancel and charge a second paid turn.
    if (turn.current && !turn.current.finished) return;
    cancel();
    const controller = new AbortController(),
      current = {
        controller,
        player: !demo && speech ? createAudioPlayer() : null,
      };
    turn.current = current;
    setBusy(true);
    callbacks.current.onBusy?.(true);
    let text = "",
      label = "",
      audioFailed = false,
      textComplete = false;
    const result = (complete = false) => ({
      kind: complete ? "answer" : "partial",
      answers: [
        {
          topic: "ai",
          title: demo
            ? "Simulated AI answer"
            : complete
              ? "AI answer · check against your records"
              : "AI answer arriving · incomplete",
          text,
          sources: ["Selected project and field records"],
        },
      ],
      sourceLabel: label,
    });
    const flush = () => {
      clearTimeout(current.flushTimer);
      current.flushTimer = null;
      if (turn.current === current)
        callbacks.current.onResult(result(textComplete));
    };
    const updateBalance = (event) =>
      setConfig((previous) => ({
        ...previous,
        balanceMicros: event.balanceMicros ?? previous?.balanceMicros,
      }));
    const emit = async (event) => {
      if (turn.current !== current) return;
      if (event.type === "start") {
        label = event.source;
        callbacks.current.onMessage(
          demo ? "Demo answer arriving…" : "AI answer arriving…",
          { status: true },
        );
      }
      if (event.type === "text") {
        text += event.delta;
        // Tokens accumulate outside React; render at most every 50 ms.
        if (!current.flushTimer) current.flushTimer = setTimeout(flush, 50);
      }
      if (event.type === "audio" && !audioFailed) {
        try {
          await current.player?.append(
            event.audio,
            event.format,
            event.sampleRate,
          );
          if (turn.current !== current) return;
          if (!current.audioStarted) {
            current.audioStarted = true;
            setAudioPlaying(true);
            callbacks.current.onMessage("Speaking answer…", { status: true });
          }
        } catch {
          audioFailed = true;
          setAudioPlaying(false);
          callbacks.current.onMessage(
            "Audio could not play. Your answer is shown; use Read answer aloud for device speech.",
          );
        }
      }
      if (event.type === "speech_error") {
        audioFailed = true;
        setAudioPlaying(false);
        callbacks.current.onMessage(
          `${event.message} Use Read answer aloud for device speech.`,
        );
      }
      if (
        (event.type === "text_done" || event.type === "done") &&
        !textComplete
      ) {
        textComplete = true;
        flush();
        updateBalance(event);
        if (event.type === "text_done" && speech && !demo) {
          callbacks.current.onMessage(
            audioFailed
              ? "Your answer is ready. Use Read answer aloud for device speech."
              : current.audioStarted
                ? "Speaking answer…"
                : "Answer ready. Preparing voice…",
            audioFailed ? undefined : { status: true },
          );
        }
      }
    };
    try {
      try {
        await current.player?.unlock();
      } catch {
        audioFailed = true;
        callbacks.current.onMessage(
          "Hosted audio is blocked. Your text answer will still appear.",
        );
      }
      if (controller.signal.aborted)
        throw new DOMException("Stopped", "AbortError");
      if (demo) {
        const answer = await demoAnswer(
          project,
          question,
          emit,
          controller.signal,
        );
        if (
          speech &&
          window.SpeechSynthesisUtterance &&
          turn.current === current
        ) {
          const utterance = new window.SpeechSynthesisUtterance(answer);
          utterance.lang = "en-US";
          utterance.onstart = () => {
            if (turn.current === current) setAudioPlaying(true);
          };
          const ended = () => {
            if (turn.current === current) setAudioPlaying(false);
          };
          utterance.onend = utterance.onerror = ended;
          window.speechSynthesis?.speak(utterance);
        }
      } else {
        const response = await fetch("/api/ai/answer", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            question,
            requestId: crypto.randomUUID(),
            speech: speech && !audioFailed,
            audioFormat: "pcm_s16le",
            priceMicros: config.priceMicros,
            preferenceScope: config.preferenceScope,
          }),
        });
        await readAnswerStream(response, emit, controller.signal);
        await current.player?.drain(controller.signal);
      }
      if (turn.current === current && !audioFailed)
        callbacks.current.onMessage(
          demo
            ? "Demo complete. No providers contacted or credits spent."
            : "AI answer complete. Credits updated.",
          { status: true },
        );
    } catch (error) {
      if (turn.current === current) {
        if (!textComplete && (text || current.flushTimer)) flush();
        callbacks.current.onMessage(
          error.name === "AbortError"
            ? "AI stopped. Check credits before asking again."
            : error.message,
        );
      }
      if (!demo && turn.current === current) refresh();
    } finally {
      current.finished = true;
      clearTimeout(current.flushTimer);
      if (turn.current === current) {
        // Keep demo utterance cancellable until the next action/unmount.
        current.player?.stop();
        setBusy(false);
        if (!demo) setAudioPlaying(false);
        callbacks.current.onBusy?.(false);
        if (!demo) turn.current = null;
      }
    }
  }
  return {
    available: config?.enabled,
    active,
    mode,
    needsConsent: Boolean(config?.enabled && mode !== "free" && !active),
    checking:
      source === "google" && !demo && (config === null || configCheck.pending),
    configCheck,
    setActive,
    busy,
    isPending: () => Boolean(turn.current && !turn.current.finished),
    audioPlaying,
    ask,
    cancel,
    refresh,
    demo,
    config,
  };
}
