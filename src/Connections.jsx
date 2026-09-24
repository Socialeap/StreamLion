import { useEffect, useState } from "react";
import {
  connectGoogle,
  disconnectGoogle,
  createWorkbook,
  pickWorkbook,
  readWorkbook,
  hasGoogleSession,
} from "./google";
const localGoogleConfig = {
  clientId: import.meta.env?.VITE_GOOGLE_CLIENT_ID || "",
  apiKey: import.meta.env?.VITE_GOOGLE_PICKER_API_KEY || "",
  appId: import.meta.env?.VITE_GOOGLE_PROJECT_NUMBER || "",
};
export default function Connections({
  bookId,
  onWorkbook,
  onDisconnect,
  onExport,
  busyCapture,
}) {
  const [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [configLoading, setConfigLoading] = useState(true),
    [googleConfig, setGoogleConfig] = useState(null),
    [connected, setConnected] = useState(hasGoogleSession());

  useEffect(() => {
    let current = true;
    async function loadGoogleConfig() {
      try {
        const response = await fetch("/api/google-config", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Google settings unavailable");
        const config = await response.json();
        if (current) {
          setGoogleConfig({
            clientId:
              typeof config.clientId === "string" ? config.clientId : "",
            apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
            appId: typeof config.appId === "string" ? config.appId : "",
          });
        }
      } catch {
        // Vite dev has no Pages Function, so local QA can use .env.local.
        if (current && import.meta.env?.DEV) setGoogleConfig(localGoogleConfig);
        else if (current)
          setGoogleConfig({ clientId: "", apiKey: "", appId: "" });
      } finally {
        if (current) setConfigLoading(false);
      }
    }
    loadGoogleConfig();
    return () => {
      current = false;
    };
  }, []);

  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setConnected(hasGoogleSession());
    }
  }
  async function open(id) {
    if (!id) return;
    const data = await readWorkbook(id);
    onWorkbook(id, data);
    setStatus("Workbook verified. Project records stay in Google.");
  }
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Connections</h1>
          <p>Your records in Google. Your workspace in StreamLion.</p>
        </div>
      </header>
      <section className="editor">
        <h2>Google Sheets & Drive</h2>
        <p>
          Connect to create a workbook or select an existing StreamLion
          workbook. Authorization expires; reconnect when asked. Tokens stay in
          memory.
        </p>
        {configLoading && <p role="status">Loading Google connection…</p>}
        {!configLoading && !googleConfig?.clientId && (
          <p role="status" className="error">
            Google connection setup is incomplete for this StreamLion app. The
            app owner needs to finish its Google setup.
          </p>
        )}
        {!configLoading &&
          googleConfig?.clientId &&
          (!googleConfig.apiKey || !googleConfig.appId) && (
            <p role="status" className="hint">
              Choosing an existing workbook is temporarily unavailable. You can
              still connect Google and create a workbook.
            </p>
          )}
        <div className="actions">
          <button
            className="primary"
            disabled={
              busy || busyCapture || configLoading || !googleConfig?.clientId
            }
            onClick={() =>
              act(async () => {
                onDisconnect();
                await connectGoogle(googleConfig.clientId);
                setStatus("Connected. Create or select a workbook.");
              })
            }
          >
            Connect Google
          </button>
          <button
            disabled={busy || busyCapture || !connected}
            onClick={() =>
              act(async () => {
                const b = await createWorkbook();
                await open(b.spreadsheetId);
              })
            }
          >
            Create workbook
          </button>
          <button
            disabled={
              busy ||
              busyCapture ||
              !connected ||
              configLoading ||
              !googleConfig?.apiKey ||
              !googleConfig?.appId
            }
            onClick={() =>
              act(async () => open(await pickWorkbook(googleConfig)))
            }
          >
            Choose workbook
          </button>
          {connected && (
            <button
              disabled={busy || busyCapture}
              onClick={() => {
                disconnectGoogle();
                onDisconnect();
                setConnected(false);
                setStatus(
                  "Disconnected. Google records removed from this view; device drafts remain available when you reconnect to their workbook.",
                );
              }}
            >
              Disconnect
            </button>
          )}
        </div>
        {bookId && (
          <p>
            <a
              href={`https://docs.google.com/spreadsheets/d/${bookId}/edit`}
              target="_blank"
              rel="noreferrer"
            >
              Open connected workbook ↗
            </a>
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {status && <p role="status">{status}</p>}
        <p className="hint">
          The app requests access to files you create or explicitly select.
          ChatGPT connects to Google separately. Record history and sources
          remain in your workbook and Drive.
        </p>
      </section>
      <section className="export">
        <h2>Local workspace backup</h2>
        <p>
          Export device-only records. Audio downloads separately. Google records
          are available through your workbook.
        </p>
        <button onClick={onExport}>Export local jobs and notes</button>
      </section>
    </>
  );
}
