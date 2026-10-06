import { useState } from "react";
import {
  createBackup,
  inspectBackup,
  restoreBackup,
  BACKUP_LIMIT,
} from "./backup.js";
import { download } from "./storage.js";
import { Archive, Download, LoaderCircle } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import DownloadNotice from "./DownloadNotice.jsx";

export default function BackupPanel({ disabled, onBusy, onRestored }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [downloadName, setDownloadName] = useState(""),
    [workingLabel, setWorkingLabel] = useState("Working…"),
    [selected, setSelected] = useState(null);
  async function act(task, label = "Working…") {
    setBusy(true);
    onBusy?.(true);
    setError("");
    setNotice("");
    setDownloadName("");
    setWorkingLabel(label);
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
    <section className="editor section-card" aria-label="Device backup">
      <SectionHeading icon={Archive} tone="blue">
        Keep a device backup
      </SectionHeading>
      <p>
        Save unfinished drafts, waiting field records, photos, voice memos and
        any workbook copies kept on this device.
      </p>
      <button
        disabled={disabled || busy}
        onClick={() =>
          act(async () => {
            const file = await createBackup();
            const name = `streamlion-backup-${new Date().toISOString().slice(0, 10)}.json`;
            download(file, name);
            setDownloadName(name);
          }, "Preparing backup…")
        }
      >
        {busy ? (
          <LoaderCircle size={18} className="loading-icon" aria-hidden="true" />
        ) : (
          <Download size={18} aria-hidden="true" />
        )}
        {busy ? workingLabel : "Download device backup"}
      </button>
      {busy && (
        <p className="hint" role="status">
          {workingLabel} Keep StreamLion open.
        </p>
      )}
      <DownloadNotice fileName={downloadName} label="Backup" />
      <p className="hint backup-privacy">
        Keep the file somewhere safe; it contains your project details. Google
        sign-in is not included.
      </p>
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
