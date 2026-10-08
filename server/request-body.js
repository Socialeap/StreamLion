export class RequestBodyError extends Error {
  constructor(status) {
    super(status === 413 ? "Request too large." : "Invalid request body.");
    this.status = status;
  }
}

// Content-Length is only an early rejection hint. Enforce bytes on the actual
// stream, including chunked requests and multibyte input, before concatenating.
export async function boundedBytes(request, maximum) {
  if (Number(request.headers.get("Content-Length")) > maximum) {
    await request.body?.cancel();
    throw new RequestBodyError(413);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new RequestBodyError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function boundedText(request, maximum) {
  const bytes = await boundedBytes(request, maximum);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError(400);
  }
}
