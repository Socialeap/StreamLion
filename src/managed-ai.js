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
    unlock: async () => {
      if (context) await context.resume();
    },
    async append(base64) {
      if (!context || closed)
        throw new Error("Hosted audio cannot play in this browser.");
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer);
      if (closed) return;
      if (context.state !== "running")
        throw new Error("Audio playback is blocked.");
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      next = Math.max(next, context.currentTime + 0.04);
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
