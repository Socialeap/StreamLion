export const creditDollars = (micros) =>
  `$${(micros / 1000000).toFixed(micros % 10000 ? 4 : 2)}`;

export async function readAnswerStream(response, onEvent, signal) {
  if (!response.ok) {
    let message = "AI is unavailable. Try again later.";
    try {
      message = (await response.json()).error || message;
    } catch {
      /* Sanitized fallback. */
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("No answer stream was received.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    doneEvent = false;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") doneEvent = true;
        await onEvent(event);
      }
      if (buffer.length > 4 * 1024 * 1024)
        throw new Error("The answer stream is too large.");
      if (done) break;
    }
    if (!doneEvent || buffer.trim())
      throw new Error(
        "Connection interrupted. Partial text may be incomplete. Check credits before asking again.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createAudioPlayer(
  Context = window.AudioContext || window.webkitAudioContext,
) {
  let context = null;
  try {
    context = Context ? new Context() : null;
  } catch {
    /* Text remains usable when audio initialization fails. */
  }
  let next = 0,
    closed = false;
  const nodes = new Set();
  return {
    // Called in the submit/microphone user gesture, before the first network await.
    available: Boolean(context),
    unlock: async () => {
      if (!context || closed)
        throw new Error("Hosted audio cannot play in this browser.");
      await context.resume();
      if (context.state !== "running")
        throw new Error("Audio playback is blocked.");
    },
    async append(base64, format = "wav", sampleRate = 24000) {
      if (!context || closed)
        throw new Error("Hosted audio cannot play in this browser.");
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      let buffer;
      if (format === "pcm_s16le") {
        if (
          sampleRate !== 24000 ||
          !bytes.length ||
          bytes.length % 2 ||
          bytes.length > 9600
        )
          throw new Error("Invalid voice audio frame.");
        buffer = context.createBuffer(1, bytes.length / 2, sampleRate);
        const channel = buffer.getChannelData(0),
          view = new DataView(bytes.buffer);
        for (let i = 0; i < channel.length; i++)
          channel[i] = view.getInt16(i * 2, true) / 32768;
      } else if (format === "wav") {
        buffer = await context.decodeAudioData(bytes.buffer);
      } else throw new Error("Unsupported voice audio format.");
      if (closed) return;
      if (context.state !== "running")
        throw new Error("Audio playback is blocked.");
      if (
        Math.max(next - context.currentTime, 0) + buffer.duration > 60 ||
        nodes.size >= 512
      )
        throw new Error("Voice playback queue is too large.");
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      // Add the cushion only at startup or after a real underrun. Re-applying
      // it to every arriving small frame would insert gaps into the voice.
      if (next <= context.currentTime) next = context.currentTime + 0.08;
      source.start(next);
      next += buffer.duration;
      nodes.add(source);
      source.onended = () => {
        nodes.delete(source);
        source.disconnect();
      };
    },
    async drain(signal) {
      const deadline = Date.now() + 120000;
      while (nodes.size && !closed && !signal.aborted && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (nodes.size && !closed && !signal.aborted)
        throw new Error("Voice playback timed out.");
    },
    stop() {
      closed = true;
      for (const node of nodes) {
        try {
          node.stop();
          node.disconnect();
        } catch {
          /* Already ended. */
        }
      }
      nodes.clear();
      context?.close().catch(() => {});
    },
  };
}

export async function demoAnswer(project, question, onEvent, signal) {
  // Deliberately a fixture, not a claimed replacement for model intelligence.
  const isName = /name|called/i.test(question),
    isContact = /contact/i.test(question);
  const text = isName
    ? `The project/location name is ${project.title || "not recorded"}. Source: Project name.`
    : isContact
      ? `The recorded site contact is ${project.contact1Name || "not recorded"}. Source: Site contact.`
      : "This is a simulated answer stream. The live pilot will use Luna to interpret your question against the selected Google project.";
  await onEvent({
    type: "start",
    priceMicros: 0,
    source:
      "Local demo · simulated intelligence and device voice; no providers or credits",
  });
  for (const delta of text.match(/.{1,16}/g) || []) {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await onEvent({ type: "text", delta });
  }
  await onEvent({ type: "done", balanceMicros: 0 });
  return text;
}

export function aiAvailabilityMessage(source, config) {
  if (source === "device")
    return "AI answers need a project saved in a selected Google workbook. Open Connections to choose a workbook, then save or open the project there.";
  if (source === "copy")
    return "This is a saved Google copy. Reconnect Google and refresh the project before using AI answers.";
  if (!config)
    return "Checking AI pilot availability… Saved-detail lookup remains free.";
  if (config.enabled)
    return "AI is available. Turn on Use AI pilot for broader questions; the displayed credit price applies.";
  return (
    {
      pilot_paused:
        "The AI pilot is paused. Saved-detail lookup is available; AI testing must be enabled for a supervised session.",
      pilot_unavailable:
        "The AI pilot needs administrator configuration before it can be used. Continue with free saved-detail lookup while the administrator completes setup.",
      account_not_enabled:
        "This Google account is not enrolled in the AI pilot. Contact the pilot administrator to arrange access and credits.",
      connect_google: "Reconnect Google before using AI answers.",
      select_workbook:
        "Choose a Google workbook in Connections before using AI answers.",
      status_unavailable:
        "AI availability could not be checked. Check your connection and try Check AI availability again.",
    }[config.reason] ||
    "AI is unavailable for this account or session. Saved-detail lookup remains available. Check AI availability to try again."
  );
}
