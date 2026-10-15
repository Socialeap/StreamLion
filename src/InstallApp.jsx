import { useEffect, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import {
  installationState,
  subscribeInstallation,
  startInstallListening,
  requestInstallation,
} from "./installation.js";
export default function InstallApp({ disabled }) {
  const state = useSyncExternalStore(subscribeInstallation, installationState);
  useEffect(() => {
    startInstallListening();
  }, []);
  if (state.installed) return null;
  return (
    <details className="install-app">
      <summary>
        <Download size={18} aria-hidden="true" />
        Install app
      </summary>
      <div className="install-instructions">
        <h2>Keep StreamLion on your home screen</h2>
        <p>
          Installation is optional. Your account and records use the same
          website.
        </p>
        {state.available && (
          <button
            className="primary"
            disabled={disabled || state.busy}
            onClick={requestInstallation}
          >
            Install StreamLion
          </button>
        )}
        {state.busy && <p role="status">Waiting for your browser…</p>}
        {state.message && <p role="status">{state.message}</p>}
        <p>
          <strong>Chrome on Android:</strong> open the browser menu, choose
          Install and create shortcut, then Install. Some versions use Add to
          Home screen.
        </p>
        <p>
          <strong>iPhone or iPad:</strong> open in Safari, then Share → Add to
          Home Screen. On desktop Chrome or Edge, use the install option in the
          address bar or browser menu.
        </p>
        <p className="hint">
          If no install option is available, keep using the website. Use a
          regular browser window for saved device work; private browsing can
          discard it when the session ends.
        </p>
      </div>
    </details>
  );
}
