import { useEffect, useRef, useState } from "react";
import { creditLabel } from "./managed-ai.js";
const pendingKey = "streamlion-hosted-speech-pending-v1";
function readPending() {
  try {
    return JSON.parse(window.localStorage.getItem(pendingKey) || "null");
  } catch {
    return null;
  }
}
async function json(response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw Error(
      "Speech status is uncertain. Check the request before trying again.",
    );
  }
  if (!response.ok) throw Error(value.error || "Speech is unavailable.");
  return value;
}
export default function VoiceControls({
  device,
  onTestDevice,
  canSpeak,
  request,
  source,
  onBeforePlay,
  controllerRef,
}) {
  const [config, setConfig] = useState(null),
    [quote, setQuote] = useState(null),
    [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(readPending),
    [clip, setClip] = useState("");
  const preview = useRef(null),
    audio = useRef(null),
    flight = useRef(null),
    quoteRef = useRef(null),
    clipRef = useRef("");
  const requestKey = JSON.stringify(request);
  const currentRequest = useRef(requestKey);
  currentRequest.current = requestKey;
  function stop() {
    flight.current?.abort();
    flight.current = null;
    setBusy(false);
    preview.current?.pause();
    audio.current?.pause();
  }
  if (controllerRef) controllerRef.current = { stop };
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (source === "google")
      fetch("/api/speech/config", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(json)
        .then((v) => {
          if (alive) setConfig(v);
        })
        .catch(() => {
          if (alive) setConfig({ enabled: false });
        });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [source]);
  useEffect(() => {
    stop();
    quoteRef.current = null;
    setQuote(null);
    setStatus("");
    if (clipRef.current) URL.revokeObjectURL(clipRef.current);
    clipRef.current = "";
    setClip("");
  }, [requestKey]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hide);
    return () => {
      stop();
      if (clipRef.current) URL.revokeObjectURL(clipRef.current);
      if (controllerRef) controllerRef.current = null;
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  function clearPending(id = pending?.id) {
    if (readPending()?.id === id) window.localStorage.removeItem(pendingKey);
    setPending(null);
  }

  async function recover() {
    if (flight.current || !pending) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    try {
      const response = await fetch(
        "/api/speech/status?requestId=" +
          encodeURIComponent(pending.id) +
          "&scope=" +
          encodeURIComponent(pending.scope),
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const row = await response.json();
      if (
        response.status === 404 &&
        row.state === "not_found" &&
        row.scope === pending.scope
      ) {
        // A lost POST may still be validating. Wait beyond its signed quote's
        // expiry before concluding that it cannot create a later reservation.
        if (!pending.expiresAt || Date.now() < pending.expiresAt + 300000) {
          setStatus(
            "No reservation found yet. Check again in six minutes before preparing another clip.",
          );
          return;
        }
        clearPending();
        setStatus("This request was not reserved. No speech charge was made.");
        return;
      }
      if (!response.ok)
        throw Error(row.error || "Speech status is unavailable.");
      if (controller.signal.aborted) return;
      if (row.state === "reserved")
        setStatus(
          "Speech is still pending. Check again later; do not submit another request.",
        );
      else if (row.state === "failed" || row.state === "complete") {
        clearPending();
        setStatus(
          row.state === "failed"
            ? "Speech failed; reserved credits were returned."
            : "Speech was prepared and charged. It is not generated again automatically.",
        );
      } else throw Error("Speech status is unavailable.");
    } catch (e) {
      if (!controller.signal.aborted) setStatus(e.message);
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  async function getQuote() {
    if (flight.current || pending || !request || !config?.enabled) return;
    stop();
    onBeforePlay();
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setStatus("");
    try {
      const q = await json(
        await fetch("/api/speech/quote", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        }),
      );
      if (!controller.signal.aborted && requestKey === currentRequest.current) {
        const next = { ...q, requestKey };
        quoteRef.current = next;
        setQuote(next);
      }
    } catch (e) {
      if (!controller.signal.aborted) setStatus(e.message);
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  async function prepare() {
    const q = quoteRef.current;
    if (
      flight.current ||
      pending ||
      readPending() ||
      !q ||
      q.requestKey !== currentRequest.current ||
      q.expiresAt <= Date.now()
    ) {
      setStatus("Review a fresh quote, or check your pending speech request.");
      return;
    }
    const id = crypto.randomUUID(),
      record = { id, scope: config.scope, expiresAt: q.expiresAt };
    try {
      window.localStorage.setItem(pendingKey, JSON.stringify(record));
      if (readPending()?.id !== id) throw Error("storage");
    } catch {
      setStatus(
        "Speech needs request recovery storage. Device voice and text remain available.",
      );
      return;
    }
    setPending(record);
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    onBeforePlay();
    setStatus("");
    // Consume this quote locally before the asynchronous request; no double-click replay.
    quoteRef.current = null;
    setQuote(null);
    try {
      const response = await fetch("/api/speech/speak", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, quoteToken: q.quoteToken }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const value = await response.json();
        if (response.status === 502) {
          clearPending(id);
        } else if (
          [400, 401, 402, 403, 409, 415, 422, 503].includes(response.status) &&
          !value.state
        ) {
          /* Reservation may be uncertain after a network edge failure: status read decides. */
        }
        throw Error(
          value.error || "Speech could not be prepared. Check its status.",
        );
      }
      if (
        response.headers.get("content-type") !== "audio/wav" ||
        response.headers.get("x-speech-request-id") !== id
      )
        throw Error("Unexpected speech response. Check request status.");
      const blob = await response.blob();
      if (blob.size > 2 * 1024 * 1024 || blob.size < 44)
        throw Error("Audio could not load. Check speech status.");
      if (controller.signal.aborted || q.requestKey !== currentRequest.current)
        return;
      if (clipRef.current) URL.revokeObjectURL(clipRef.current);
      clipRef.current = URL.createObjectURL(blob);
      setClip(clipRef.current);
      clearPending(id);
      setStatus(
        "Speech prepared and charged once. Play or replay this audio below without another charge.",
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setStatus(e.message + " Your text remains available.");
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section className="voice-options" aria-label="Voice and speech options">
      <h3>Device voice · included</h3>
      <label>
        Device voice
        <select
          value={
            device.voices.some((v) => v.voiceURI === device.preference.voiceURI)
              ? device.preference.voiceURI
              : ""
          }
          onChange={(e) => {
            stop();
            device.change({ voiceURI: e.target.value });
          }}
          disabled={!canSpeak}
        >
          <option value="">Browser default</option>
          {device.voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} · {v.lang}
            </option>
          ))}
        </select>
      </label>
      <label>
        Speech speed
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.1"
          value={device.preference.rate}
          onChange={(e) => {
            stop();
            device.change({ rate: Number(e.target.value) });
          }}
          disabled={!canSpeak}
        />
        <span>{device.preference.rate}×</span>
      </label>
      <button
        type="button"
        disabled={!canSpeak}
        onClick={() => {
          stop();
          onTestDevice();
        }}
      >
        Test device voice
      </button>
      {!canSpeak && (
        <p>
          Device speech is unavailable in this browser. Text remains available.
        </p>
      )}
      <h3>Preview hosted voice · no credits</h3>
      <audio
        ref={preview}
        controls
        preload="none"
        src="/voice/kokoro-af-heart-preview.wav"
        aria-label="Kokoro hosted voice sample"
        onPlay={() => {
          audio.current?.pause();
          onBeforePlay();
        }}
      />
      <p className="hint">
        Prerecorded Kokoro af_heart publisher sample. No project text is sent
        and no credits are used. Live delivery can differ.
      </p>
      <details className="quiet-details">
        <summary>Sample transcript and source</summary>
        <p>
          The sky above the port was the color of television, tuned to a dead
          channel.
        </p>
        <a
          href="https://huggingface.co/hexgrad/Kokoro-82M/blob/ea4fcc6f4ccf6cdea832cafa5083cf4d40ea66db/SAMPLES.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          Kokoro publisher sample
        </a>
      </details>
      <h3>Read this answer with hosted speech</h3>
      <p>
        Speech only: no AI answer is generated. Names and contact details in the
        reviewed text go to DeepInfra. Access instructions stay on device
        speech.
      </p>
      {!config?.enabled ? (
        <p>
          Paid hosted speech is not available. Free lookup, device voice and
          text remain available.
        </p>
      ) : (
        <p>
          {creditLabel(config.priceMicros)} per clip, up to {config.maxChars}{" "}
          characters. Uses purchased credits. Review a fresh quote before every
          charge.
        </p>
      )}
      {pending && (
        <>
          <p>
            Check the existing speech request before preparing another clip.
            Return to its original account and workbook if needed.
          </p>
          <button type="button" disabled={busy} onClick={recover}>
            Check speech request
          </button>
        </>
      )}
      <button
        type="button"
        disabled={busy || !!pending || !request || !config?.enabled}
        onClick={getQuote}
      >
        Review speech-only price
      </button>
      {!request && (
        <p className="hint">
          First get a free saved-detail answer to quote its speech.
        </p>
      )}
      {quote && (
        <div className="fact-answer">
          <p>This exact text will be sent to DeepInfra:</p>
          <p className="note-text">{quote.text}</p>
          <p>
            {creditLabel(quote.priceMicros)} ·{" "}
            {creditLabel(quote.balanceMicros)} purchased credits available.
            Quote expires in one minute.
          </p>
          <button
            type="button"
            disabled={
              busy || !!pending || quote.priceMicros > quote.balanceMicros
            }
            onClick={prepare}
          >
            Prepare speech — {creditLabel(quote.priceMicros)}
          </button>
          <button
            type="button"
            onClick={() => {
              quoteRef.current = null;
              setQuote(null);
            }}
          >
            Keep device voice and text
          </button>
        </div>
      )}
      {clip && (
        <audio
          ref={audio}
          controls
          preload="none"
          src={clip}
          aria-label="Prepared speech"
          onPlay={() => {
            preview.current?.pause();
            onBeforePlay();
          }}
          onError={() =>
            setStatus(
              "Playback failed. The prepared clip was charged once; no automatic retry is made. Text remains available.",
            )
          }
        />
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
