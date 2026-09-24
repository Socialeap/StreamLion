// This UI is deliberately data-free until the MCP connection has per-user auth.
// The existing PWA owns Google access; the MCP endpoint never receives tokens.
export const STREAMLION_WIDGET_URI = "ui://streamlion/workspace-v2.html";
export const STREAMLION_APP_URL = "https://streamlion.transcendencemedia.com/";

export const STREAMLION_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { font: 15px/1.45 system-ui, sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172923; background: #f5faf7; }
    main { border: 1px solid #dbe8e0; border-radius: 16px; padding: 20px; background: #fff; }
    .eyebrow { color: #356555; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { font-size: 20px; line-height: 1.2; margin: 8px 0; }
    p { margin: 0 0 14px; color: #4c5c55; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
    .fact { border-radius: 10px; padding: 10px 12px; background: #f1f7f3; }
    .fact span { display: block; color: #547064; font-size: 12px; }
    .fact strong { display: block; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; }
    button, a.action { min-height: 42px; border-radius: 8px; padding: 10px 14px; border: 1px solid #c9d9d0; color: #164b39; background: #fff; font: inherit; font-weight: 650; cursor: pointer; text-decoration: none; }
    button.primary { color: white; border-color: #164b39; background: #164b39; }
    button:focus-visible, a:focus-visible { outline: 3px solid #82c7a8; outline-offset: 2px; }
    #workspace { display: none; margin-top: 14px; }
    #workspace iframe { width: 100%; height: min(78vh, 780px); border: 1px solid #dbe8e0; border-radius: 10px; background: white; }
    #status { margin-top: 10px; font-size: 13px; }
    @media (max-width: 520px) { main { padding: 16px; } .facts { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">StreamLion</div>
    <h1 id="title">Your field workspace</h1>
    <p id="description">Ask a quick question here, or open the workspace to review a project.</p>
    <div id="sample" hidden>
      <div class="facts">
        <div class="fact"><span>City</span><strong id="city"></strong></div>
        <div class="fact"><span>Visit</span><strong id="visit"></strong></div>
        <div class="fact"><span>Details</span><strong id="review"></strong></div>
        <div class="fact"><span>Source</span><strong>Example only</strong></div>
      </div>
    </div>
    <div class="actions">
      <button class="primary" id="in-chat" type="button">Open workspace here</button>
      <a class="action" id="in-browser" href="https://streamlion.transcendencemedia.com/" target="_blank" rel="noopener noreferrer">Open in browser</a>
      <button id="ask" type="button" hidden>Ask about this example</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
    <div id="workspace"></div>
  </main>
  <script>
    const APP_URL = "https://streamlion.transcendencemedia.com/";
    const byId = id => document.getElementById(id);
    let current = null;

    function render(data) {
      if (!data || !["workspace", "sample"].includes(data.kind)) return;
      current = data;
      const sample = data.kind === "sample";
      byId("sample").hidden = !sample;
      byId("ask").hidden = !sample;
      byId("title").textContent = sample ? data.title : "Your field workspace";
      byId("description").textContent = sample
        ? "A sample project card for testing the ChatGPT interface. No Google records were read."
        : "Ask a quick question here, or open the workspace to review a project.";
      if (sample) {
        byId("city").textContent = data.city || "Unknown";
        byId("visit").textContent = data.visit || "Not set";
        byId("review").textContent = data.review || "Draft";
      }
    }

    render(window.openai?.toolOutput);
    window.addEventListener("message", event => {
      if (event.source !== window.parent || event.data?.jsonrpc !== "2.0") return;
      if (event.data.method === "ui/notifications/tool-result") {
        render(event.data.params?.structuredContent);
      }
    }, { passive: true });

    byId("in-chat").addEventListener("click", async () => {
      byId("status").textContent = "Opening StreamLion…";
      try {
        await window.openai?.requestDisplayMode?.({ mode: "fullscreen" });
        if (!byId("workspace").firstChild) {
          const frame = document.createElement("iframe");
          frame.src = APP_URL;
          frame.title = "StreamLion field workspace";
          frame.allow = "microphone";
          frame.referrerPolicy = "no-referrer";
          byId("workspace").append(frame);
        }
        byId("workspace").style.display = "block";
        byId("status").textContent = "If sign-in does not open here, choose Open in browser.";
      } catch {
        byId("status").textContent = "ChatGPT could not expand this view. Use Open in browser.";
      }
    });

    byId("in-browser").addEventListener("click", async event => {
      if (!window.openai?.openExternal) return;
      event.preventDefault();
      await window.openai.openExternal({ href: APP_URL, redirectUrl: false });
    });

    byId("ask").addEventListener("click", async () => {
      if (!current || current.kind !== "sample") return;
      const prompt = "This is StreamLion's synthetic example project. What would I need to confirm before saving a real project?";
      if (window.openai?.sendFollowUpMessage) {
        await window.openai.sendFollowUpMessage({ prompt });
      } else {
        byId("status").textContent = "Ask that question in the ChatGPT message box.";
      }
    });
  </script>
</body>
</html>`;
