import { useState } from "react";
import {
  createBackup,
  inspectBackup,
  restoreBackup,
  BACKUP_LIMIT,
} from "./backup.js";
import { download } from "./storage.js";

export default function BackupPanel({ disabled, onBusy, onRestored }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(null);
  async function act(task) {
    setBusy(true);
    onBusy?.(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <section className="editor" aria-label="Device backup">
      <h2>Keep a device backup</h2>
      <p>
        Save unfinished drafts, waiting field records, photos, voice memos and
        any workbook copies kept on this device.
      </p>
      <button
        disabled={disabled || busy}
        onClick={() =>
          act(async () => {
            const file = await createBackup();
            download(
              file,
              `streamlion-backup-${new Date().toISOString().slice(0, 10)}.json`,
            );
            setNotice(
              "Backup download started. Keep the file somewhere safe; it contains your project details. Google sign-in is not included.",
            );
          })
        }
      >
        {busy ? "Working…" : "Download device backup"}
      </button>
      <details>
        <summary>Restore a device backup</summary>
        <p>
          Choose a backup to review it first. Matching records are kept once. If
          records conflict, nothing is replaced. Restoring never sends records
          to Google.
        </p>
        <label>
          Backup file
          <input
            type="file"
            accept=".json,application/json"
            disabled={disabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              setSelected(null);
              if (!file) return;
              act(async () => {
                if (file.size > BACKUP_LIMIT)
                  throw new Error("Choose a backup up to 100 MB.");
                const inspected = await inspectBackup(file);
                setSelected({ file, ...inspected.summary });
              });
            }}
          />
        </label>
        {selected && (
          <div>
            <p>
              {selected.projects} projects · {selected.notes} field records ·{" "}
              {selected.files} files · {selected.drafts} unfinished drafts
            </p>
            <button
              disabled={disabled || busy}
              onClick={() =>
                act(async () => {
                  await restoreBackup(selected.file);
                  await onRestored?.();
                  setSelected(null);
                  setNotice(
                    "Backup restored on this device. Reconnect Google before sending waiting records.",
                  );
                })
              }
            >
              Restore on this device
            </button>
          </div>
        )}
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
