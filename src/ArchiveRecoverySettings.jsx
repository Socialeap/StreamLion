import React, { useRef, useState } from "react";

export default function ArchiveRecoverySettings({
  busy,
  recovering,
  restore,
  capacity,
}) {
  const [file, setFile] = useState("");
  const attempt = useRef(null);
  return (
    <details className="coord-card">
      <summary>Archives and workbook recovery</summary>
      <p>
        Keep the original workbook and Drive folder. To start a fresh workspace,
        choose a new compatible StreamLion workbook in Core Connections, keep
        the same private Drive folder, then enable provider Google access here.
        New requests use the selected workbook. Switch back to the original
        workbook to manage its existing requests.
      </p>
      {capacity?.rowCounts && (
        <p>
          Current workbook records: {capacity.rowCounts.join(" / ")} ·{" "}
          {capacity.rowCeiling || 9999} per tab.
        </p>
      )}
      <h2>Recover an archived job</h2>
      <p>
        Paste the private archive file link from the original Drive folder. This
        checks the archive and its Drive originals, then adds the job's history
        to the selected workbook. Existing records and original files are kept.
        The job stays archived; old client sign-in links stay expired.
      </p>
      <p>
        Recovery supports verified version 2 archives after the original job has
        been archived. Earlier archives need review of the original workbook.
        External links remain references; their files are not backed up.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const value = file.trim();
          if (!value) return;
          if (!attempt.current || attempt.current.fileId !== value)
            attempt.current = { fileId: value, operation: crypto.randomUUID() };
          const result = await restore(attempt.current);
          if (result?.complete) {
            attempt.current = null;
            setFile("");
          }
        }}
      >
        <label>
          Archive file link or ID
          <input
            value={file}
            onChange={(e) => setFile(e.target.value)}
            disabled={busy || recovering}
            maxLength={400}
            required
          />
        </label>
        <button disabled={busy || recovering || !file.trim()}>
          Verify and recover archived job
        </button>
      </form>
      {recovering && (
        <p>
          Recover the original pending save above before starting another
          recovery.
        </p>
      )}
    </details>
  );
}
