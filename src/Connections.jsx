import { useState } from "react";
import {
  connectGoogle,
  disconnectGoogle,
  createWorkbook,
  pickWorkbook,
  readWorkbook,
  hasGoogleSession,
} from "./google";
const configKey = "streamlion-google-public-config";
const publicDefaults = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
  apiKey: import.meta.env.VITE_GOOGLE_PICKER_API_KEY || "",
  appId: import.meta.env.VITE_GOOGLE_PROJECT_NUMBER || "",
};
export default function Connections({
  bookId,
  onWorkbook,
  onDisconnect,
  onExport,
  busyCapture,
}) {
  const [config, setConfig] = useState(() => {
      try {
        return {
          ...publicDefaults,
          ...JSON.parse(localStorage.getItem(configKey)),
        };
      } catch {
        return publicDefaults;
      }
    }),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(hasGoogleSession());
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
        <details open={!config.clientId}>
          <summary>Google application setup</summary>
          <p className="hint">
            The app owner supplies these public identifiers. Never paste a
            client secret or access token here. See the repository’s Google
            setup guide.
          </p>
          {[
            ["clientId", "OAuth web client ID"],
            ["apiKey", "Picker API key (existing workbooks)"],
            ["appId", "Google Cloud project number (existing workbooks)"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={config[key] || ""}
                onChange={(e) =>
                  setConfig({ ...config, [key]: e.target.value.trim() })
                }
              />
            </label>
          ))}
          <button
            disabled={busy}
            onClick={() => {
              try {
                localStorage.setItem(configKey, JSON.stringify(config));
                setStatus("Public application settings saved on this device.");
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Save application settings
          </button>
        </details>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || busyCapture}
            onClick={() =>
              act(async () => {
                onDisconnect();
                await connectGoogle(config.clientId || "");
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
            disabled={busy || busyCapture || !connected}
            onClick={() => act(async () => open(await pickWorkbook(config)))}
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
