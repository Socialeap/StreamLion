import { useState } from "react";
import { FileUp } from "lucide-react";
import { PROJECT_FIELDS } from "./project-schema.js";
import { readBrief } from "./read-brief.js";
import { creditLabel } from "./managed-ai.js";
import { BRIEF_LIMITS } from "./brief-import-contract.js";
import { filterBrief } from "./brief-privacy.js";
import {
  briefRequest,
  readPendingBrief,
  keepPendingBrief,
  forgetPendingBrief,
} from "./brief-import.js";

const availability = {
  not_open:
    "In-app brief preparation is not open yet. You can still use your own ChatGPT account or enter details yourself.",
  sign_in: "Sign in to Google before preparing a brief with credits.",
  license_required:
    "A StreamLion license is required to prepare briefs with credits.",
  unavailable:
    "Availability could not be checked. Your draft and credits are unchanged.",
  qa_expired:
    "The owner-only QA window has ended or has not started. Existing prepared briefs can still be recovered.",
  qa_exhausted:
    "All three owner QA attempts have been used. Existing prepared briefs can still be recovered. No additional credits are needed.",
  qa_replacement_exhausted:
    "The replacement QA attempt has been used. Recover any existing prepared brief. No additional credits are needed.",
  qa_grant_unavailable:
    "The replacement QA permission could not be verified. Your draft and credits are unchanged.",
};
const dollars = (micros) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    micros / 1000000,
  );

export default function BriefImporter({
  draftKey,
  fields,
  onUse,
  disabled = false,
  request = briefRequest,
  readFile = readBrief,
}) {
  const [open, setOpen] = useState(false),
    [config, setConfig] = useState(null);
  const [text, setText] = useState(""),
    [sourceName, setSourceName] = useState("Pasted text");
  const [pending, setPending] = useState(() => readPendingBrief(draftKey));
  const [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [privatePhrases, setPrivatePhrases] = useState([]);
  const [phrase, setPhrase] = useState("");
  const working = busy || disabled;
  const locked = working || !!pending;

  function acceptResult(data) {
    if (data.state === "complete") {
      setResult(data);
      setNotice(
        "Review the prepared details below. Nothing has been added to your draft or saved to Google.",
      );
    } else if (data.state === "pending")
      setNotice(
        "Your brief is still being prepared. Recover it again shortly; do not submit another request.",
      );
    else if (["failed", "expired"].includes(data.state)) {
      forgetPendingBrief(draftKey);
      setPending(null);
      setResult(null);
      setNotice(
        data.error || "This brief is unavailable. Your draft is unchanged.",
      );
    } else
      throw new Error(
        "The brief result could not be read. Recover the existing brief before trying again.",
      );
  }
  async function check() {
    setBusy(true);
    setError("");
    try {
      if (pending)
        acceptResult(
          await request("result?id=" + encodeURIComponent(pending.requestId)),
        );
      setConfig(await request("config"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function chooseFile(event) {
    const input = event.target,
      file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const value = await readFile(file);
      setText(value.text);
      setSourceName(value.sourceName);
      setPreview(null);
      setPrivatePhrases([]);
      setNotice(
        "PDF text loaded on this device. Review it before confirming preparation.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      input.value = "";
      setBusy(false);
    }
  }
  async function prepare() {
    if (disabled) return;
    setBusy(true);
    setError("");
    setNotice("");
    let marker;
    let persisted = false;
    try {
      if (!config?.enabled || !config.canPrepare || pending)
        throw new Error(
          "Check availability and recover any pending brief first.",
        );
      if (!text.trim() || text.length > BRIEF_LIMITS.characters)
        throw new Error(
          "Paste up to 6,000 characters, or choose a shorter PDF.",
        );
      if (!preview) throw new Error("Review what OpenAI will receive first.");
      marker = { requestId: crypto.randomUUID(), scope: config.scope };
      // Persist recovery identity BEFORE sending a paid request. Source text stays in memory.
      keepPendingBrief(draftKey, marker);
      persisted = true;
      setPending(marker);
      acceptResult(
        await request("prepare", {
          ...marker,
          quoteKey: config.quoteKey,
          priceMicros: config.priceMicros,
          text: preview.text,
          sourceName: preview.sourceName,
          privacy: preview.privacy,
        }),
      );
    } catch (e) {
      if (e.definite && marker) {
        forgetPendingBrief(draftKey);
        setPending(null);
      }
      setError(
        marker && !persisted
          ? "This device could not keep a recovery reference. No request was sent or credits charged. Back up your draft and free device storage before trying again."
          : marker && !e.definite
            ? "The connection was interrupted. Use Recover prepared brief; do not pay for a new request."
            : e.message,
      );
    } finally {
      if (persisted) {
        try {
          // A pending or failed attempt still consumes the owner QA allowance.
          // Refresh only configuration; never retry the paid preparation.
          setConfig(await request("config"));
        } catch {
          // Keep the prepared result/recovery marker if this read is unavailable.
        }
      }
      setBusy(false);
    }
  }
  async function useResult() {
    setBusy(true);
    setError("");
    try {
      // Recheck account/workbook ownership immediately before importing the recovered result.
      const current = await request(
        "result?id=" + encodeURIComponent(pending.requestId),
      );
      if (current.state !== "complete") {
        acceptResult(current);
        return;
      }
      onUse(current.project.fields);
      forgetPendingBrief(draftKey);
      setPending(null);
      setResult(null);
      setText("");
      setPreview(null);
      setPrivatePhrases([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const rows = result
    ? PROJECT_FIELDS.filter((field) => result.project.fields[field.key])
    : [];
  return (
    <section
      className="native-brief-card"
      aria-label="Prepare my project in StreamLion"
    >
      <FileUp size={28} aria-hidden="true" />
      <h3>Prepare my project here</h3>
      <p>
        Upload a readable PDF or paste your project messages. StreamLion
        prepares the details for you to review, using credits.
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="native-brief-input"
        disabled={working}
        onClick={() => {
          setOpen(!open);
          if (!open) check();
        }}
      >
        {open
          ? "Hide brief preparation"
          : pending
            ? "Recover prepared brief"
            : "Upload a brief or paste text"}
      </button>
      {open && (
        <div className="brief-import" id="native-brief-input">
          <label className="file-label">
            Choose brief PDF
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={locked}
              onChange={chooseFile}
            />
          </label>
          <p className="hint">
            Up to 5 MB, 20 pages and 6,000 characters of readable text. Scanned
            or image-only pages are not supported here; paste their text or use
            your own ChatGPT account.
          </p>
          <details className="brief-pdf-tips">
            <summary>Easy ways to turn emails or messages into a PDF</summary>
            <ul>
              <li>
                <strong>Email thread:</strong> Open the full conversation on
                your computer, choose Print all (or Print), then Save as PDF.
                Check that all relevant messages are included.
              </li>
              <li>
                <strong>Text messages:</strong> Copy the relevant messages into
                Google Docs or another document app, keeping names and dates.
                Choose Export as PDF, or Print → Save as PDF.
              </li>
              <li>
                <strong>On a phone:</strong> PDF options vary by app. If
                printing is unavailable, copy the messages and paste them below.
                This is often the quickest option.
              </li>
            </ul>
            <p>
              Use selectable text, rather than screenshots. Remove unrelated
              conversations and private information before continuing.
            </p>
          </details>
          <label htmlFor="native-brief-text">
            Or, paste the PDF text, email thread or messages here:
          </label>
          <textarea
            id="native-brief-text"
            rows={6}
            value={text}
            disabled={locked}
            onChange={(event) => {
              setText(event.target.value);
              setSourceName("Pasted text");
              setPreview(null);
            }}
            aria-describedby="native-brief-privacy"
          />
          <p className="hint">
            {text.length.toLocaleString()} / 6,000 characters · {sourceName}
          </p>
          <p id="native-brief-privacy" className="hint">
            Turn your messages into a clear project brief. StreamLion filters
            detected names, contact details and addresses on your device, and
            leaves out detected passwords and access codes. Review the preview
            and hide anything else before sending text to OpenAI. Your original
            PDF stays on your device. Review{" "}
            <a
              href="/api/privacy#brief-preparation"
              target="_blank"
              rel="noreferrer"
            >
              data handling
            </a>{" "}
            for more information.
          </p>
          <details>
            <summary>How your information is handled</summary>
            <p>
              OpenAI organizes the filtered text and checks the prepared brief
              against it. If problems are found, StreamLion requests one
              correction and a final check. All steps are included in the
              displayed price.
            </p>
            <p>
              OpenAI does not use API content for training by default. It may
              keep text and results for safety checks, normally for up to 30
              days, with legal or safety exceptions. Filtering can miss details;
              review the preview. You can enter project details yourself
              instead.
            </p>
            <p>
              StreamLion receives the replacement details separately to restore
              names and contacts; that list is not sent to OpenAI. Removed
              access codes are not restored. The restored result is encrypted
              for 24-hour recovery and normally removed within 48 hours. Nothing
              is saved to Google until you save the project.
            </p>
          </details>
          {!pending && (
            <div className="brief-privacy-preview">
              <label htmlFor="native-private-phrase">
                Hide another name or private phrase
              </label>
              <input
                id="native-private-phrase"
                value={phrase}
                maxLength={500}
                disabled={locked}
                onChange={(e) => setPhrase(e.target.value)}
              />
              <button
                type="button"
                disabled={
                  locked ||
                  phrase.trim().length < 2 ||
                  privatePhrases.length >= 30
                }
                onClick={() => {
                  setPrivatePhrases([...privatePhrases, phrase.trim()]);
                  setPhrase("");
                  setPreview(null);
                }}
              >
                Add to hidden details
              </button>
              {privatePhrases.length > 0 && (
                <>
                  <p>{privatePhrases.length} extra private phrases selected.</p>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setPrivatePhrases([]);
                      setPreview(null);
                    }}
                  >
                    Clear extra hidden phrases
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={
                  locked ||
                  !text.trim() ||
                  text.length > BRIEF_LIMITS.characters
                }
                onClick={() => {
                  try {
                    setPreview(filterBrief(text, fields, privatePhrases));
                    setError("");
                  } catch (e) {
                    setPreview(null);
                    setError(e.message);
                  }
                }}
              >
                Preview what OpenAI will receive
              </button>
              {preview && (
                <>
                  <label htmlFor="native-filtered-text">Text for OpenAI</label>
                  <textarea
                    id="native-filtered-text"
                    rows={6}
                    readOnly
                    value={preview.text}
                  />
                  <p>
                    {preview.privacy.entries.length} private details replaced
                    with reference labels. Check for any names or details you
                    still want to hide.
                  </p>
                  {preview.privacy.entries.length > 0 && (
                    <details>
                      <summary>Review hidden details</summary>
                      <ul>
                        {preview.privacy.entries.map((e) => (
                          <li key={e.token}>
                            {e.value} → {e.token}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <p>
                    Lines containing passwords or labeled entry codes are
                    excluded from AI preparation. Move any work requirements on
                    those lines to a separate line before preparing. Keep any
                    needed entry details in the project’s access instructions
                    yourself. Existing draft details are unchanged.
                  </p>
                </>
              )}
            </div>
          )}
          {config && !config.enabled && (
            <p role="status">
              {availability[config.reason] || availability.unavailable}
            </p>
          )}
          {config?.enabled && (
            <p className="brief-quote">
              {creditLabel(config.priceMicros)} ({dollars(config.priceMicros)})
              per completed preparation. Failed preparations return reserved
              credits. {creditLabel(config.balanceMicros)} available.
            </p>
          )}
          {config?.enabled && config.ownerQA && (
            <p role="status">
              {config.ownerQA.replacement
                ? "Owner-only replacement QA"
                : "Owner-only QA"}{" "}
              · {config.ownerQA.attemptsRemaining} of{" "}
              {config.ownerQA.attemptLimit || 3} attempts remaining. Uses
              existing test credits. Ends{" "}
              {new Date(config.ownerQA.expiresAt).toLocaleString()}. Failed
              attempts return credits but still count toward the limit.
            </p>
          )}
          {config?.enabled && !config.canPrepare && config.ownerQA && (
            <p role="status">
              Owner QA funding is unavailable. Check the approved test wallet;
              do not buy or transfer credits.
            </p>
          )}
          {config?.enabled && !config.canPrepare && !config.ownerQA && (
            <p>
              Add credits before preparing a brief.{" "}
              <a href="/api/credits">View credits</a>.
            </p>
          )}
          <div className="brief-actions">
            {pending ? (
              <button type="button" disabled={working} onClick={check}>
                Recover prepared brief
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    working ||
                    !config?.enabled ||
                    !config.canPrepare ||
                    !text.trim() ||
                    !preview ||
                    text.length > BRIEF_LIMITS.characters
                  }
                  onClick={prepare}
                >
                  {busy
                    ? "Preparing…"
                    : config?.enabled
                      ? `Prepare my project · ${creditLabel(config.priceMicros)}`
                      : "Prepare my project"}
                </button>
                <button type="button" disabled={working} onClick={check}>
                  Check brief availability
                </button>
              </>
            )}
          </div>
          {notice && <p role="status">{notice}</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {result && (
            <div
              className="brief-review"
              role="region"
              aria-label="Review prepared brief"
            >
              <h4>Review before adding to your draft</h4>
              {result.workflowVersion === 2 && (
                <p>
                  The brief was prepared and checked against your filtered text,
                  with one correction and recheck if needed. This is not a
                  guarantee of accuracy. Missing or conflicting source details
                  need your confirmation.
                </p>
              )}
              <p>
                Check names, measurements, dates and payment terms against the
                original. Existing details are kept; only empty fields will be
                filled. You can edit everything in the next steps.
              </p>
              <dl>
                {rows.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{result.project.fields[field.key]}</dd>
                    {fields[field.key]?.trim() &&
                      fields[field.key] !==
                        result.project.fields[field.key] && (
                        <dd className="hint">
                          Keeping your existing detail: {fields[field.key]}
                        </dd>
                      )}
                  </div>
                ))}
              </dl>
              <button
                type="button"
                className="primary"
                disabled={working}
                onClick={useResult}
              >
                Fill empty fields with these details
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  forgetPendingBrief(draftKey);
                  setPending(null);
                  setResult(null);
                  setNotice(
                    "Prepared details discarded. Your draft is unchanged. Preparation credits are not refunded when you discard a completed result.",
                  );
                }}
              >
                Discard prepared details
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
