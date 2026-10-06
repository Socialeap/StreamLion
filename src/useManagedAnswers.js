import { useEffect, useRef, useState } from "react";
import {
  createAudioPlayer,
  readAnswerStream,
  demoAnswer,
} from "./managed-ai.js";
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
  const [active, setActive] = useState(demo),
    [busy, setBusy] = useState(false);
  const lifetime = useRef(null);
  const turn = useRef(null),
    callbacks = useRef({ onBusy, onResult, onMessage });
  callbacks.current = { onBusy, onResult, onMessage };
  function cancel() {
    const current = turn.current;
    turn.current = null;
    if (current) {
      current.controller.abort();
      current.player?.stop();
      window.speechSynthesis?.cancel();
    }
    setBusy(false);
    callbacks.current.onBusy?.(false);
    if (current && !demo) refresh();
  }
  function refresh() {
    const owner = lifetime.current;
    if (!owner || source !== "google" || demo) return;
    fetch("/api/ai/config", {
      credentials: "same-origin",
      cache: "no-store",
      signal: owner.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (lifetime.current === owner && !owner.signal.aborted && data) {
          setConfig(data);
          if (!data.enabled) setActive(false);
        }
      })
      .catch(() => {});
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (!demo && source === "google")
      fetch("/api/ai/config", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!controller.signal.aborted) setConfig(data);
        })
        .catch(() => {});
    const hide = () => {
      if (document.hidden && turn.current) {
        cancel();
        callbacks.current.onMessage(
          "AI stopped when the app left the screen. Check credits before asking again.",
        );
      }
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
      audioFailed = false;
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
    const emit = async (event) => {
      if (turn.current !== current) return;
      if (event.type === "start") {
        label = event.source;
        callbacks.current.onMessage(
          demo ? "Demo answer arriving…" : "AI answer arriving…",
        );
      }
      if (event.type === "text") {
        text += event.delta;
        callbacks.current.onResult(result());
      }
      if (event.type === "audio" && !audioFailed) {
        try {
          await current.player?.append(event.audio);
        } catch {
          audioFailed = true;
          callbacks.current.onMessage(
            "Audio could not play. Your answer is shown; use Read answer aloud for device speech.",
          );
        }
      }
      if (event.type === "speech_error") {
        audioFailed = true;
        callbacks.current.onMessage(event.message);
      }
      if (event.type === "done") {
        callbacks.current.onResult(result(true));
        setConfig((previous) => ({
          ...previous,
          balanceMicros: event.balanceMicros ?? previous.balanceMicros,
        }));
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
            speech,
            priceMicros: config.priceMicros,
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
        );
    } catch (error) {
      if (turn.current === current)
        callbacks.current.onMessage(
          error.name === "AbortError"
            ? "AI stopped. Check credits before asking again."
            : error.message,
        );
      if (!demo && turn.current === current) refresh();
    } finally {
      if (turn.current === current) {
        // Keep demo utterance cancellable until the next action/unmount.
        current.player?.stop();
        setBusy(false);
        callbacks.current.onBusy?.(false);
        if (!demo) turn.current = null;
      }
    }
  }
  return {
    available: config?.enabled,
    active,
    setActive,
    busy,
    ask,
    cancel,
    refresh,
    demo,
    config,
  };
}
