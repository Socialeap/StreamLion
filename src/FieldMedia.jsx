import { useEffect, useState } from "react";
import { getAudio, download } from "./storage";
import { readFieldFile } from "./google";

export default function FieldMedia({ note }) {
  const [blob, setBlob] = useState(null),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    getAudio(note.audioId || note.id)
      .then((value) => {
        if (current) setBlob(value || null);
      })
      .catch(() => {
        if (current) setError("The local file could not be opened.");
      });
    return () => {
      current = false;
    };
  }, [note.id, note.audioId]);
  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl("");
    };
  }, [blob]);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const file = await readFieldFile(note.audioUrl);
      if (!/^(audio|image)\//.test(file.type))
        throw new Error("Preview is unavailable. Open the file in Drive.");
      setBlob(file);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!blob && !note.audioId && !note.audioUrl && !error) return null;
  return (
    <div className="field-media">
      {url && blob.type.startsWith("audio/") && (
        <>
          <p>Voice memo · listen and review</p>
          <audio
            controls
            preload="metadata"
            src={url}
            aria-label={`Voice memo for ${note.area}`}
          />
        </>
      )}
      {url && blob.type.startsWith("image/") && (
        <img
          src={url}
          alt={`Field photo: ${note.area}`}
          onError={() =>
            setError(
              "This image format cannot be previewed here. Download the original or open it in Drive.",
            )
          }
        />
      )}
      <div className="actions">
        {blob && (
          <button
            onClick={() =>
              download(
                blob,
                note.fileName ||
                  `streamlion-${note.id}.${blob.type.startsWith("image/") ? "jpg" : blob.type.includes("mp4") ? "m4a" : "webm"}`,
              )
            }
          >
            Download original
          </button>
        )}
        {note.audioUrl && (
          <>
            <a href={note.audioUrl} target="_blank" rel="noopener noreferrer">
              Open field file in Drive ↗
            </a>
            {!blob && (
              <button disabled={busy} onClick={load}>
                {busy ? "Loading…" : "Load file for review"}
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
