import { useState } from "react";
import { download, loadWorkspace } from "./storage.js";
import { hasGoogleSession } from "./google.js";
export default function SupportPanel() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function diagnostics() {
    setBusy(true);
    setError("");
    try {
      const records = await loadWorkspace();
      const data = {
        service: "StreamLion",
        createdAt: new Date().toISOString(),
        revision:
          typeof __STREAMLION_REVISION__ !== "undefined"
            ? __STREAMLION_REVISION__
            : "development",
        browser: navigator.userAgent,
        online: navigator.onLine,
        googleAuthorized: hasGoogleSession(),
        deviceProjects: records.jobs.length,
        deviceFieldRecords: records.notes.length,
      };
      download(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
        "streamlion-diagnostics.json",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor">
      <h2>Help & privacy</h2>
      <p>
        Need help? Contact{" "}
        <a href="mailto:info@transcendencemedia.com">
          info@transcendencemedia.com
        </a>
        .
      </p>
      <div className="actions">
        <button disabled={busy} onClick={diagnostics}>
          Download support details
        </button>
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          How your data is handled ↗
        </a>
      </div>
      <p className="hint">
        Support details include the app version, browser and record counts.
        Project text, Google IDs and sign-in credentials are excluded. Nothing
        is sent automatically.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
