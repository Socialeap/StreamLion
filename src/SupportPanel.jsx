import { useState } from "react";
import { download, loadWorkspace } from "./storage.js";
import { hasGoogleSession } from "./google.js";
import { LifeBuoy, Download, LoaderCircle } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import DownloadNotice from "./DownloadNotice.jsx";
export default function SupportPanel() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [downloadName, setDownloadName] = useState("");
  async function diagnostics() {
    setBusy(true);
    setError("");
    setDownloadName("");
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
        theme: document.documentElement.dataset.theme || "light",
        displayMode: window.matchMedia?.("(display-mode: standalone)").matches
          ? "standalone"
          : "browser",
        deviceProjects: records.jobs.length,
        deviceFieldRecords: records.notes.length,
      };
      download(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
        "streamlion-diagnostics.json",
      );
      setDownloadName("streamlion-diagnostics.json");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor section-card" aria-label="Help & privacy">
      <SectionHeading icon={LifeBuoy} tone="amber">
        Help & privacy
      </SectionHeading>
      <p>
        Need help? Contact{" "}
        <a href="mailto:info@transcendencemedia.com">
          info@transcendencemedia.com
        </a>
        .
      </p>
      <div className="actions">
        <button disabled={busy} onClick={diagnostics}>
          {busy ? (
            <LoaderCircle
              size={18}
              className="loading-icon"
              aria-hidden="true"
            />
          ) : (
            <Download size={18} aria-hidden="true" />
          )}
          {busy ? "Preparing support details…" : "Download support details"}
        </button>
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          How your data is handled ↗
        </a>
      </div>
      {busy && (
        <p className="hint" role="status">
          Preparing support details… Keep StreamLion open.
        </p>
      )}
      <DownloadNotice fileName={downloadName} label="Support details" />
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
