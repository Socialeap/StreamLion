/* Static CSS recovery only. Never reads or clears account, project or draft storage. */
(() => {
  const validCSS = (response) =>
    response?.ok &&
    /^text\/css(?:\s*;|$)/i.test(response.headers.get("Content-Type") || "");
  async function stylesheet(request) {
    const invalid = [];
    try {
      for (const name of await caches.keys()) {
        if (!name.startsWith("workbox-precache-")) continue;
        const cache = await caches.open(name);
        const response = await cache.match(request);
        if (validCSS(response)) return response;
        if (response) invalid.push(cache);
      }
    } catch {
      /* A cache read failure can still recover from the network. */
    }
    let response;
    try {
      response = await fetch(request, { cache: "reload" });
    } catch {
      return Response.error();
    }
    // Pages can temporarily serve its HTML fallback for an asset during rollout.
    // Such a response must never replace a stylesheet, even with HTTP 200.
    if (!validCSS(response)) return Response.error();
    await Promise.all(
      invalid.map(async (cache) => {
        try {
          await cache.put(request, response.clone());
        } catch {
          /* Deliver valid CSS even if the cache cannot be repaired. */
        }
      }),
    );
    return response;
  }
  // Imported before Workbox registers its routes. Claim only built stylesheets
  // and explicitly prevent a later listener from responding to the same event.
  self.addEventListener("fetch", (event) => {
    const request = event.request,
      url = new URL(request.url);
    if (
      request.method !== "GET" ||
      request.destination !== "style" ||
      url.origin !== self.location.origin ||
      !/^\/assets\/[\w-]+\.css$/.test(url.pathname)
    )
      return;
    event.stopImmediatePropagation();
    event.respondWith(stylesheet(request));
  });
})();
