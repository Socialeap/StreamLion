// Only reads can be retried automatically. Writes retain their original IDs
// and are reconciled by the workbook/file adapters after an unknown outcome.
export async function fetchRead(url, options = {}, policy = {}) {
  const fetcher = policy.fetcher || fetch;
  const pause =
    policy.pause || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = policy.now || Date.now;
  const deadline = now() + 30000;
  const read = !options.method || options.method === "GET";
  for (let attempt = 0; ; attempt++) {
    let response, failure;
    try {
      const timeout = AbortSignal.timeout(
        Math.max(1, Math.min(20000, deadline - now())),
      );
      response = await fetcher(url, {
        ...options,
        signal: options.signal
          ? AbortSignal.any([options.signal, timeout])
          : timeout,
      });
    } catch (error) {
      failure = error;
    }
    if (
      !read ||
      attempt === 2 ||
      options.signal?.aborted ||
      (!failure && ![429, 502, 503, 504].includes(response.status))
    ) {
      if (failure) throw failure;
      return response;
    }
    const retryAfter = response?.headers?.get("Retry-After");
    const requested =
      retryAfter == null
        ? 0
        : /^\d+(?:\.\d+)?$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : Math.max(0, Date.parse(retryAfter) - now());
    const delay = Math.max(
      500 * 2 ** attempt + Math.floor(Math.random() * 250),
      Number.isFinite(requested) ? requested : 0,
    );
    if (delay > 10000 || now() + delay >= deadline) {
      if (failure) throw failure;
      return response;
    }
    await response?.body?.cancel();
    await pause(delay);
  }
}
