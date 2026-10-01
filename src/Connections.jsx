import { useEffect, useState, useRef } from "react";
import BackupPanel from "./BackupPanel.jsx";
import SupportPanel from "./SupportPanel.jsx";
import { fetchRead } from "./network.js";
import {
  connectGoogle,
  forgetGoogleConnection,
  startPersistentGoogle,
  googleAccount,
  googleFolderId,
  ensureGoogleFolder,
  rememberGoogleFolder,
  moveWorkbookToFolder,
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
  busyCapture,
  onRestore,
  restoreError,
  siteCopy,
  onSiteCopy,
  onBackupBusy,
  onBackupRestored,
  onConnectionBusy,
}) {
  const [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [configLoading, setConfigLoading] = useState(true),
    [configLoadError, setConfigLoadError] = useState(false),
    [configAttempt, setConfigAttempt] = useState(0),
    [googleConfig, setGoogleConfig] = useState(null);
  const connected = hasGoogleSession();
  const [folderId, setFolderId] = useState(googleFolderId());
  const createdWorkbook = useRef(null);
  useEffect(() => {
    setFolderId(googleFolderId());
  }, [connected, bookId]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    async function loadGoogleConfig() {
      setConfigLoading(true);
      setConfigLoadError(false);
      try {
        const response = await fetchRead("/api/google-config", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Google settings unavailable");
        const config = await response.json();
        if (
          !config ||
          typeof config !== "object" ||
          typeof config.clientId !== "string" ||
          typeof config.apiKey !== "string" ||
          typeof config.appId !== "string"
        ) {
          throw new Error("Google settings response was invalid");
        }
        if (current) {
          setGoogleConfig({
            clientId: config.clientId,
            apiKey: config.apiKey,
            appId: config.appId,
            persistentEnabled: config.persistentEnabled === true,
          });
        }
      } catch {
        // Vite dev has no Pages Function, so local QA can use .env.local.
        if (current && import.meta.env?.DEV) {
          setGoogleConfig(localGoogleConfig);
        } else if (current) {
          setGoogleConfig(null);
          setConfigLoadError(true);
        }
      } finally {
        if (current) setConfigLoading(false);
      }
    }
    loadGoogleConfig();
    return () => {
      current = false;
      controller.abort();
    };
  }, [configAttempt]);

  async function act(fn) {
    setBusy(true);
    onConnectionBusy?.(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setFolderId(googleFolderId());
      setBusy(false);
      onConnectionBusy?.(false);
    }
  }
  async function open(id) {
    if (!id) return;
    const data = await readWorkbook(id);
    await onWorkbook(id, data);
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
          {googleConfig?.persistentEnabled
            ? "Connect Google once, then choose where your projects will be saved. We'll reopen your saved workbook when you return."
            : "Connect Google and choose or create the workbook for your projects."}
        </p>
        {configLoading && <p role="status">Loading Google connection…</p>}
        {!configLoading && configLoadError && (
          <div className="error" role="alert">
            <p>
              Couldn’t load Google connection settings. Check your connection
              and try again.
            </p>
            <button
              type="button"
              disabled={busy || busyCapture}
              onClick={() => setConfigAttempt((attempt) => attempt + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {!configLoading && !configLoadError && !googleConfig?.clientId && (
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
        {googleAccount() && <p>Connected as {googleAccount()}</p>}
        {restoreError && (
          <div role="alert">
            <p>{restoreError}</p>
            <button
              disabled={busy || busyCapture}
              onClick={() =>
                act(async () => {
                  await onRestore();
                })
              }
            >
              Retry saved connection
            </button>
          </div>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={
              busy || busyCapture || configLoading || !googleConfig?.clientId
            }
            onClick={() =>
              act(async () => {
                createdWorkbook.current = null;
                if (googleConfig.persistentEnabled) {
                  startPersistentGoogle();
                  return;
                }
                onDisconnect(true);
                await connectGoogle(googleConfig.clientId);
                if (bookId) {
                  await open(bookId);
                } else {
                  setStatus("Connected. Create or select a workbook.");
                }
              })
            }
          >
            {connected && googleConfig?.persistentEnabled
              ? "Switch Google account"
              : "Connect Google"}
          </button>
          <button
            disabled={busy || busyCapture || !connected}
            onClick={() =>
              act(async () => {
                const b = createdWorkbook.current || (await createWorkbook());
                createdWorkbook.current = b;
                await moveWorkbookToFolder(b.spreadsheetId);
                await open(b.spreadsheetId);
                createdWorkbook.current = null;
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
            {bookId && connected ? "Switch workbook" : "Choose workbook"}
          </button>
          {connected && (
            <button
              disabled={busy || busyCapture}
              onClick={() =>
                act(async () => {
                  createdWorkbook.current = null;
                  await forgetGoogleConnection();
                  onDisconnect();
                  setStatus(
                    "Disconnected. Google records removed from this view; device drafts remain available when you reconnect to their workbook.",
                  );
                })
              }
            >
              Disconnect
            </button>
          )}
        </div>
        {connected && (
          <section className="google-folder" aria-label="StreamLion folder">
            <h3 title="Your home for StreamLion workbooks and project files in Google Drive.">
              StreamLion folder
            </h3>
            <p>
              {folderId
                ? "This folder will reopen with your saved Google connection. New workbooks and project files go here."
                : "Set up one home for your workbooks and project files. Creating a workbook also sets this up for you."}
            </p>
            {folderId && (
              <p>
                <a
                  href={`https://drive.google.com/drive/folders/${folderId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open StreamLion folder ↗
                </a>
              </p>
            )}
            <div className="actions">
              {!folderId && (
                <button
                  disabled={busy || busyCapture}
                  onClick={() =>
                    act(async () => {
                      setFolderId(await ensureGoogleFolder());
                      setStatus(
                        "StreamLion folder is ready. Choose an existing workbook or create one here.",
                      );
                    })
                  }
                >
                  Set up StreamLion folder
                </button>
              )}
              <button
                disabled={
                  busy ||
                  busyCapture ||
                  configLoading ||
                  !googleConfig?.apiKey ||
                  !googleConfig?.appId
                }
                onClick={() =>
                  act(async () => {
                    const id = await pickWorkbook(googleConfig, true);
                    if (id) {
                      await rememberGoogleFolder(id);
                      setFolderId(id);
                      setStatus(
                        "Folder saved. Existing workbooks and files stay where they are.",
                      );
                    }
                  })
                }
              >
                {folderId ? "Change folder" : "Use an existing folder"}
              </button>
              {folderId && bookId && (
                <button
                  disabled={busy || busyCapture}
                  onClick={() =>
                    act(async () => {
                      if (
                        !window.confirm(
                          "Move the selected workbook into your StreamLion folder? It will inherit that folder’s sharing settings. Existing project files stay where they are.",
                        )
                      )
                        return;
                      await moveWorkbookToFolder(bookId);
                      setStatus("Workbook is in your StreamLion folder.");
                    })
                  }
                >
                  Move selected workbook here
                </button>
              )}
            </div>
            <p className="hint">
              Use the workbook chooser to open an existing Sheet, even if it is
              already in this folder. Changing folders does not move previous
              project files.
            </p>
          </section>
        )}
        {createdWorkbook.current && error && (
          <p>
            A workbook was created. Retry Create workbook to finish its setup,
            or{" "}
            <a
              href={`https://docs.google.com/spreadsheets/d/${createdWorkbook.current.spreadsheetId}/edit`}
              target="_blank"
              rel="noreferrer"
            >
              open it in Google
            </a>
            .
          </p>
        )}
        {bookId && !connected && (
          <p role="status" className="hint">
            Your workbook is remembered on this device. Reconnect Google to load
            it before saving a project there.
          </p>
        )}
        {bookId && (
          <p>
            <a
              href={`https://docs.google.com/spreadsheets/d/${bookId}/edit`}
              target="_blank"
              rel="noreferrer"
            >
              Open selected workbook ↗
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
          Your projects and field records stay in your Google workbook and
          Drive. You control access to the files you create or choose.
        </p>
      </section>
      {bookId && onSiteCopy && (
        <section className="editor site-copy-control">
          <h2>Site copy on this device</h2>
          <p>
            {siteCopy
              ? `Workbook copy checked ${new Date(siteCopy.verifiedAt).toLocaleString()}. It can be read without signing in. New notes and files wait here until you reconnect.`
              : "Keep a read-only copy for site visits with poor reception. Use your own device because it contains project details."}
          </p>
          <button
            disabled={busy || busyCapture || (!siteCopy && !connected)}
            onClick={() => onSiteCopy(!siteCopy)}
          >
            {siteCopy
              ? "Remove workbook copy from this device"
              : "Keep workbook on this device"}
          </button>
          <p className="hint">
            Removing this copy does not delete queued field records or their
            original files. Export them before clearing browser storage.
          </p>
        </section>
      )}
      <BackupPanel
        disabled={busyCapture || busy}
        onBusy={onBackupBusy}
        onRestored={onBackupRestored}
      />
      <SupportPanel />
    </>
  );
}
