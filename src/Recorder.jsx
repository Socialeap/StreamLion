import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, Download } from "lucide-react";
import { download } from "./storage";
export default function Recorder({ jobId, area, onSave, onBusy }) {
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const mounted = useRef(true);
  const requestCancelled = useRef(false);
  const recorder = useRef(null);
  const pending = useRef(null);
  const timer = useRef(null);
  const stream = useRef(null);
  const capture = useRef(null);
  const supported =
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
  function stop() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      setState("stopping");
    }
    clearInterval(timer.current);
  }
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      if (document.hidden) {
        requestCancelled.current = true;
        stop();
      }
    };
    const leave = (e) => {
      if (stream.current || pending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", leave);
    return () => {
      mounted.current = false;
      requestCancelled.current = true;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", leave);
      clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function save() {
    setState("saving");
    try {
      await onSave(capture.current, pending.current);
      pending.current = null;
      setError("");
      setDownloadRequested(false);
      setState("idle");
      onBusy(false);
    } catch (e) {
      setError(
        `Audio not saved: ${e.message}. Retry or download the recording.`,
      );
      setState("unsaved");
    }
  }
  async function start() {
    requestCancelled.current = false;
    setDownloadRequested(false);
    setError("");
    setState("requesting");
    onBusy(true);
    capture.current = {
      jobId,
      area: area.trim(),
      createdAt: new Date().toISOString(),
    };
    try {
      const source = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission may resolve after visibility changed or this component unmounted.
      // Release the newly acquired microphone before constructing a recorder.
      if (document.hidden || requestCancelled.current || !mounted.current) {
        source.getTracks().forEach((track) => track.stop());
        if (mounted.current) {
          setError(
            "Recording cancelled because the app left the foreground. Tap Record audio to try again.",
          );
          setState("idle");
          onBusy(false);
        }
        return;
      }
      stream.current = source;
      const r = new MediaRecorder(source);
      recorder.current = r;
      const chunks = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onerror = () => {
        setError("Recording was interrupted. Review any recovered audio.");
        stop();
      };
      r.onstop = () => {
        clearInterval(timer.current);
        source.getTracks().forEach((t) => t.stop());
        stream.current = null;
        pending.current = new Blob(chunks, { type: r.mimeType });
        if (pending.current.size) save();
        else {
          setError("No audio was captured. Please try again or type a note.");
          setState("idle");
          onBusy(false);
        }
      };
      r.start(1000);
      setSeconds(0);
      setState("recording");
      let elapsed = 0;
      timer.current = setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= 60) stop();
      }, 1000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      setError(
        `Microphone unavailable: ${e.message}. You can still type a note.`,
      );
      setState("idle");
      onBusy(false);
    }
  }
  return (
    <section className="audio-capture">
      <div>
        <h3>Voice memo</h3>
        <p className="hint">
          Up to 60 seconds, while this app is visible. Stored on this device;
          transcription is not connected.
        </p>
      </div>
      {state === "idle" ? (
        <button
          type="button"
          onClick={start}
          disabled={!supported || !jobId || !area.trim()}
        >
          <Mic size={18} />
          Record audio
        </button>
      ) : state === "recording" ? (
        <button type="button" className="recording" onClick={stop}>
          <Square size={16} />
          Stop · {seconds}s
        </button>
      ) : state === "unsaved" ? (
        <div className="actions">
          <button type="button" onClick={save}>
            Retry save
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                download(
                  pending.current,
                  "streamlion-recovered-audio." +
                    (pending.current.type.includes("mp4") ? "m4a" : "webm"),
                );
                setDownloadRequested(true);
              } catch (e) {
                setError(
                  `Download could not start: ${e.message}. The audio is still available to retry.`,
                );
              }
            }}
          >
            <Download size={16} />
            Download audio
          </button>
          {downloadRequested && (
            <>
              <p className="hint">
                Check that the downloaded audio opens before continuing.
                Continuing releases this unsaved recording from memory.
              </p>
              <button
                type="button"
                onClick={() => {
                  pending.current = null;
                  capture.current = null;
                  recorder.current = null;
                  setDownloadRequested(false);
                  setError("");
                  setState("idle");
                  onBusy(false);
                }}
              >
                I have a copy — continue
              </button>
            </>
          )}
        </div>
      ) : (
        <p role="status">
          {state === "requesting"
            ? "Waiting for microphone permission…"
            : "Saving recording…"}
        </p>
      )}
      {!supported && (
        <p className="hint">Audio recording is unavailable in this browser.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
