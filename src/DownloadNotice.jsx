import { CircleCheck } from "lucide-react";
import { useEffect, useRef } from "react";

export default function DownloadNotice({ fileName, label }) {
  const notice = useRef(null);
  useEffect(() => {
    if (fileName) notice.current?.scrollIntoView?.({ block: "nearest" });
  }, [fileName]);
  if (!fileName) return null;
  return (
    <div
      ref={notice}
      className="download-feedback"
      role="status"
      aria-live="polite"
    >
      <CircleCheck size={24} aria-hidden="true" />
      <div>
        <strong>{label} download started</strong>
        <span className="download-filename">{fileName}</span>
        <p>
          Check Downloads or your file manager. If your browser asks, allow the
          download.
        </p>
      </div>
    </div>
  );
}
