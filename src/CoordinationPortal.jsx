import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PROJECT_FIELDS } from "./project-schema.js";
import NotificationSettings from "./NotificationSettings.jsx";
import { startCoordinationRefresh } from "./coordination-refresh.js";
import { subscribeUpdate, updateReady, applyUpdate } from "./updates.js";
import {
  CLIENT_FIELDS,
  MATERIAL_FIELDS,
  REQUIRED_FIELDS,
  readiness,
  CREDIT_UNIT,
  stableJSON,
} from "./client-workflow.js";
const labels = Object.fromEntries(PROJECT_FIELDS.map((f) => [f.key, f.label]));
const groups = [
  "Project",
  "Location",
  "Contacts",
  "Scope",
  "Schedule",
  "Money",
  "Documents",
];
const privateFields = new Set([
  "requesterEmail",
  "sourceNotes",
  "unresolved",
  "approxHours",
  "siteHours",
  "driveFolderUrl",
  "reference",
]);
const states = {
  draft: "Draft request",
  submitted: "Submitted",
  clarification: "Needs clarification",
  awaiting_agreement: "Awaiting agreement",
  activation_pending: "Confirming — recovery in progress",
  confirmed: "Confirmed",
  in_progress: "In progress",
  delivered: "Delivered",
  closed: "Closed · read-only",
  cancelled: "Cancelled · read-only",
  archived: "Archived",
};
const date = (value) => (value ? new Date(value).toLocaleString() : "");
export async function coordinationAPI(path, body, subject) {
  const response = await fetch("/api/coordination/" + path, {
    credentials: "same-origin",
    ...(body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(subject ? { "X-StreamLion-Account": subject } : {}),
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Connection unavailable. Your form remains open.");
  }
  if (!response.ok) {
    const error = new Error(data.error || "Please try again.");
    error.status = response.status;
    throw error;
  }
  return data;
}
export default function CoordinationPortal({
  client = false,
  api = coordinationAPI,
}) {
  const [status, setStatus] = useState(null),
    [jobs, setJobs] = useState([]),
    [pending, setPending] = useState([]),
    [archives, setArchives] = useState([]);
  const [selected, setSelected] = useState(() =>
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("job"),
    ),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState(""),
    [consent, setConsent] = useState(false),
    [email, setEmail] = useState(""),
    [title, setTitle] = useState("");
  const [verified, setVerified] = useState(false),
    [showClosed, setShowClosed] = useState(false),
    [verification, setVerification] = useState("");
  const requestRef = useRef(null);
  const [synthetic, setSynthetic] = useState(false);
  const [mail, setMail] = useState(null);
  const [activity, setActivity] = useState([]);
  const [refreshStatus, setRefreshStatus] = useState(null),
    [capacity, setCapacity] = useState(null);
  const refreshRef = useRef(null),
    loadRef = useRef(null);
  const updateAvailable = useSyncExternalStore(subscribeUpdate, updateReady);
  const jobId =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("job") || "";
  async function load({ conditional = false } = {}) {
    while (loadRef.current) {
      if (conditional) return loadRef.current;
      await loadRef.current.catch(() => {});
    }
    const task = loadView(conditional);
    loadRef.current = task;
    try {
      return await task;
    } finally {
      if (loadRef.current === task) loadRef.current = null;
    }
  }
  function rememberRefresh(data) {
    refreshRef.current = data.refresh || null;
    setRefreshStatus(data.refresh || null);
  }
  async function loadView(conditional) {
    const suffix =
      conditional && refreshRef.current?.token
        ? "?refresh=" + encodeURIComponent(refreshRef.current.token)
        : "";
    if (client) {
      const data = await api("client/job" + suffix);
      if (data.unchanged) {
        rememberRefresh(data);
        return data;
      }
      rememberRefresh(data);
      setSynthetic(Boolean(data.synthetic));
      setJobs([data.job]);
      setSelected(data.job.id);
      setBrand(data.brand);
      setActivity(data.activity || []);
      setVerified(true);
      return { jobs: [data.job] };
    } else {
      let result;
      if (conditional && status?.connected) {
        result = await api("provider/jobs" + suffix);
        if (result.unchanged) {
          rememberRefresh(result);
          return result;
        }
      }
      const data = await api("provider/status");
      setSynthetic(Boolean(data.synthetic));
      setStatus(data);
      if (data.connected) {
        result ||= await api("provider/jobs");
        rememberRefresh(result);
        setCapacity(result.capacity || null);
        setJobs(result.jobs);
        setPending(result.pending);
        setArchives(result.archives || []);
        setMail(result.mail);
        setActivity(result.activity || []);
        return result;
      }
      refreshRef.current = null;
      setJobs([]);
      return { jobs: [] };
    }
  }
  useEffect(() => {
    if (!client || !verified) return;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/api/coordination/client/manifest";
    document.head.appendChild(link);
    return () => link.remove();
  }, [client, verified]);
  useEffect(() => {
    if (client) {
      const token = new URLSearchParams(window.location.hash.slice(1)).get(
        "verify",
      );
      if (token) {
        setVerification(token);
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
        return;
      }
    }
    let active = true;
    load().catch((e) => {
      if (active && (!client || e.status !== 401)) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (busy || !(client ? verified : status?.connected)) return;
    return startCoordinationRefresh({
      refresh: load,
      pollMs: () => refreshRef.current?.pollAfterMs || 15000,
      onError: (e) => {
        setError(e.message);
        if ([401, 403].includes(e.status)) {
          setJobs([]);
          setActivity([]);
          if (client) setVerified(false);
          else setStatus(null);
          refreshRef.current = null;
        }
      },
    });
  }, [client, verified, status?.connected, busy]);
  async function perform(path, body) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    requestRef.current = { path, body };
    try {
      const result = await api(path, body, status?.subject);
      requestRef.current = null;
      const loaded = path !== "client/logout" ? await load() : null;
      return {
        ...result,
        latestJob:
          loaded?.jobs?.find((j) => j.id === body.jobId) ||
          (client ? loaded?.jobs?.[0] : null),
      };
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const selectedJob = jobs.find((j) => j.id === selected);
  const operation = () => crypto.randomUUID();
  async function command(job, action, extra = {}) {
    return perform((client ? "client" : "provider") + "/command", {
      operation: operation(),
      jobId: job.id,
      command: { action, expectedRevision: job.revision, ...extra },
    });
  }
  return (
    <div className="coord-shell">
      <header className="coord-header">
        <a href={client ? "/api/client-portal" : "/"} className="coord-brand">
          <img src="/lion-mint-192.png" alt="" />
          StreamLion
        </a>
        <span>
          {client ? brand || "Your project portal" : "Client requests"}
        </span>
        {!client && <a href="/">Field workspace</a>}
        {client && verified && (
          <button
            onClick={async () => {
              await perform("client/logout", {});
              setVerified(false);
              setJobs([]);
            }}
          >
            Sign out
          </button>
        )}
      </header>
      <main>
        {updateAvailable && (
          <p className="coord-notice">
            An app update is ready. Save any edits first.{" "}
            <button onClick={applyUpdate}>Update StreamLion</button>
          </p>
        )}
        {synthetic && (
          <p className="coord-notice" role="status">
            Local synthetic preview — no email, Google writes or charges.
          </p>
        )}
        {refreshStatus && (
          <p className="coord-notice">
            Last verified {date(refreshStatus.verifiedAt)}. Updates refresh
            while this page is open.
          </p>
        )}
        {!client && status?.delivery?.email === false && (
          <p className="coord-notice" role="status">
            Email delivery is paused. Existing verified projects remain
            available; new invitations must wait.
          </p>
        )}
        {!client && capacity?.capacityWarning && (
          <p className="coord-notice" role="status">
            This workbook is approaching its history limit. Arrange a reviewed
            workbook rollover before adding more history. Archiving retains the
            original records.
          </p>
        )}
        <div className="coord-heading">
          <div>
            <p className="eyebrow">
              {client
                ? "Everything your provider needs"
                : "Your client, connected"}
            </p>
            <h1>
              {selectedJob
                ? selectedJob.fields.title || "New request"
                : client
                  ? "Let’s get your project ready"
                  : "From request to completed work"}
            </h1>
            <p>
              {client
                ? "A free, private place to clarify scope, share instructions and follow progress."
                : "One current brief, agreed by both sides and ready for the field."}
            </p>
          </div>
          {!client && status?.connected && (
            <div className="coord-wallet">
              <strong>
                {Math.floor(status.wallet.available / CREDIT_UNIT)} credits
              </strong>
              <span>
                {status.projectMicros / CREDIT_UNIT} per confirmed job
              </span>
              <a href="/api/credits">Top up credits</a>
            </div>
          )}
        </div>
        {error && (
          <div role="alert" className="coord-alert">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="coord-notice">
            {message}
          </div>
        )}
        {(client ? verified : status?.connected) && (
          <NotificationSettings
            key={"notifications-" + (client ? selected : status?.subject)}
            role={client ? "client" : "provider"}
            subject={status?.subject}
            api={api}
          />
        )}
        {requestRef.current && error && (
          <div className="coord-actions">
            <button
              disabled={busy}
              onClick={() =>
                perform(requestRef.current.path, requestRef.current.body)
              }
            >
              Retry original request
            </button>
            <button
              disabled={busy}
              onClick={() => {
                requestRef.current = null;
                setError("");
                load().catch((e) => setError(e.message));
              }}
            >
              Review current status
            </button>
          </div>
        )}
        {client && !verified && (
          <section className="coord-card coord-signin">
            {verification ? (
              <>
                <h2>Verify your private link</h2>
                <p>Continue to this project. Your link can be used once.</p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    const result = await perform("client/verify", {
                      token: verification,
                    });
                    if (result) setVerification("");
                  }}
                >
                  Verify and open project
                </button>
              </>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api("client/request", {
                      jobId,
                      email,
                    });
                    setMessage(result.message);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h2>Open your project</h2>
                <p>
                  Use the email address your provider invited. No account or app
                  installation is needed.
                </p>
                {!jobId && (
                  <p>Open the project link shared by your provider.</p>
                )}
                <label>
                  Your email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <button disabled={busy || !jobId}>
                  Email me a private link
                </button>
              </form>
            )}
          </section>
        )}
        {!client && !status && !error && (
          <p role="status">Loading your provider workspace…</p>
        )}
        {!client && !status && error && (
          <section className="coord-card">
            <h2>Provider access</h2>
            <p>
              This workflow requires StreamLion Core and an activated client
              coordination service.
            </p>
            <a href="/api/google/start">Sign in with Google</a>
          </section>
        )}
        {!client && status && !status.connected && (
          <section className="coord-card">
            <h2>Enable your client workspace</h2>
            <p>
              Choose your workbook and private Drive folder in{" "}
              <a href="/">Connections</a>, then enable background coordination
              here.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await perform("provider/connect", { consent, brand });
              }}
            >
              <label>
                Provider name clients will see
                <input
                  value={brand}
                  maxLength={100}
                  required
                  onChange={(e) => setBrand(e.target.value)}
                />
              </label>
              <label className="coord-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I authorize StreamLion to process client updates, notifications
                and archives in this selected Google workspace for one year. I
                can revoke access here or by disconnecting Google.
              </label>
              <p>
                Eligible Core purchasers receive 600 starter credits once,
                shared with AI assistance. A job charge applies only after both
                parties approve.
              </p>
              <button disabled={busy || !consent}>
                Enable client coordination
              </button>
            </form>
          </section>
        )}
        {!client && status?.connected && (
          <>
            {mail?.stalled > 0 && (
              <p className="coord-alert">
                {mail.stalled} notification(s) need review. Keep the client’s
                project link and ask the service administrator to review the
                email transport.
              </p>
            )}
            {jobs.some(
              (j) =>
                j.archiveAt &&
                j.archiveAt <= Date.now() &&
                j.state !== "archived",
            ) && (
              <p className="coord-alert">
                Google archival is delayed for a closed project. Client access
                has ended; original records are retained. Check Google
                authorization and archive recovery.
              </p>
            )}
            {pending.length > 0 && (
              <section className="coord-alert">
                <h2>A save needs recovery</h2>
                <p>
                  Later writes to this workbook are held until its outcome is
                  verified.
                </p>
                {pending.map((p) => (
                  <button
                    key={p.id}
                    disabled={busy}
                    onClick={() =>
                      perform("provider/retry", { operation: p.id })
                    }
                  >
                    Recover original save
                  </button>
                ))}
              </section>
            )}
            <div className="coord-layout">
              <aside>
                <section className="coord-card">
                  <h2>Invite a client</h2>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const result = await perform("provider/create", {
                        operation: operation(),
                        email,
                        title,
                      });
                      if (result) {
                        setSelected(result.jobId);
                        setMessage(
                          "Invitation queued. Share this project link: " +
                            result.url,
                        );
                        setEmail("");
                        setTitle("");
                      }
                    }}
                  >
                    <label>
                      Project name
                      <input
                        value={title}
                        required
                        maxLength={1000}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </label>
                    <label>
                      Client email
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <button disabled={busy || status.delivery?.email === false}>
                      Create request & invite
                    </button>
                  </form>
                  <p className="coord-small">
                    Creating a request uses no project credits.
                  </p>
                </section>
                <section className="coord-card">
                  <h2>Your projects</h2>
                  <label className="coord-check">
                    <input
                      type="checkbox"
                      checked={showClosed}
                      onChange={(e) => setShowClosed(e.target.checked)}
                    />
                    Include closed projects
                  </label>
                  <div className="coord-job-list">
                    {jobs
                      .filter((j) => showClosed || !j.closedAt)
                      .map((j) => (
                        <button
                          key={j.id}
                          className={j.id === selected ? "selected" : ""}
                          onClick={() => setSelected(j.id)}
                        >
                          <strong>
                            {j.fields.title || "Untitled request"}
                          </strong>
                          <span>{states[j.state]}</span>
                        </button>
                      ))}
                    {!jobs.length && <p>Your first request starts here.</p>}
                  </div>
                </section>
              </aside>
              <div>
                {selectedJob ? (
                  <JobPanel
                    key={selectedJob.id}
                    job={selectedJob}
                    activity={activity.filter(
                      (e) => e.jobId === selectedJob.id,
                    )}
                    client={false}
                    busy={busy}
                    command={command}
                    upload={(file) =>
                      perform("provider/upload", {
                        operation: operation(),
                        jobId: selectedJob.id,
                        file,
                      })
                    }
                    archive={archives.find((a) => a.jobId === selectedJob.id)}
                    invite={() =>
                      perform("provider/invite", { jobId: selectedJob.id })
                    }
                    price={status.projectMicros}
                  />
                ) : (
                  <section className="coord-card">
                    <h2>A complete brief before you travel</h2>
                    <p>
                      Select a request to review scope, confirm the appointment
                      and identify missing information.
                    </p>
                  </section>
                )}
              </div>
            </div>
            <footer className="coord-footer">
              <span>
                Background authorization expires {date(status.expiresAt)}.
              </span>
              <button
                disabled={busy}
                onClick={() => perform("provider/disconnect", {})}
              >
                Revoke client coordination
              </button>
            </footer>
          </>
        )}
        {client && verified && selectedJob && (
          <JobPanel
            key={selectedJob.id}
            job={selectedJob}
            activity={activity.filter((e) => e.jobId === selectedJob.id)}
            client
            busy={busy}
            command={command}
            upload={(file) =>
              perform("client/upload", { operation: operation(), file })
            }
          />
        )}
      </main>
    </div>
  );
}
function JobPanel({
  activity = [],
  job,
  client,
  busy,
  command,
  upload,
  invite,
  price,
  archive,
}) {
  const [tab, setTab] = useState("Brief"),
    [group, setGroup] = useState("Scope"),
    [draft, setDraft] = useState(job.fields),
    [text, setText] = useState(""),
    [reason, setReason] = useState("");
  const [authorized, setAuthorized] = useState(false),
    [fileError, setFileError] = useState("");
  const [baseFields, setBaseFields] = useState(job.fields),
    [draftRevision, setDraftRevision] = useState(job.revision),
    [newer, setNewer] = useState(false);
  const closed = Boolean(job.closedAt),
    issues = readiness(job);
  const canEdit = !closed && job.state !== "activation_pending";
  const role = client ? "client" : "provider";
  useEffect(() => {
    const normalized = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [
        k,
        typeof v === "string" ? v.trim() : v,
      ]),
    );
    if (
      stableJSON(draft) === stableJSON(baseFields) ||
      stableJSON(normalized) === stableJSON(job.fields)
    ) {
      setDraft(job.fields);
      setBaseFields(job.fields);
      setDraftRevision(job.revision);
      setNewer(false);
    } else setNewer(true);
    setAuthorized(false);
  }, [job.revision]);
  const fields = PROJECT_FIELDS.filter(
    (f) => !privateFields.has(f.key) && (!client || CLIENT_FIELDS.has(f.key)),
  );
  const changed = Object.fromEntries(
    fields
      .filter((f) => draft[f.key] !== baseFields[f.key])
      .map((f) => [f.key, draft[f.key] || ""]),
  );
  const needsProposal = Boolean(
    job.accepted && Object.keys(changed).some((k) => MATERIAL_FIELDS.has(k)),
  );
  async function save(e) {
    e.preventDefault();
    if (Object.keys(changed).length) {
      const result = await command(job, needsProposal ? "propose" : "edit", {
        fields: changed,
        expectedRevision: draftRevision,
      });
      if (result?.latestJob) {
        setDraft(result.latestJob.fields);
        setBaseFields(result.latestJob.fields);
        setDraftRevision(result.latestJob.revision);
        setNewer(false);
      }
    }
  }
  const fieldNodes = fields
    .filter((f) => f.group === group)
    .map((f) => (
      <label key={f.key}>
        {f.label}
        {REQUIRED_FIELDS.includes(f.key) && (
          <span className="coord-required"> · required</span>
        )}
        {f.type === "textarea" ? (
          <textarea
            rows={3}
            value={draft[f.key] || ""}
            maxLength={6000}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        ) : f.type === "appointment" ? (
          <select
            value={draft[f.key] || ""}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          >
            <option value="">Not set</option>
            <option value="proposed">Proposed</option>
            <option value="confirmed">Confirmed</option>
          </select>
        ) : (
          <input
            type={
              ["email", "tel", "url", "date", "datetime-local"].includes(f.type)
                ? f.type
                : "text"
            }
            inputMode={
              ["money", "number"].includes(f.type) ? "decimal" : undefined
            }
            value={draft[f.key] || ""}
            maxLength={1000}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        )}
      </label>
    ));
  return (
    <section className="coord-card coord-detail">
      {newer && (
        <p className="coord-alert">
          A newer brief arrived. Your unsaved wording is preserved. Review the
          latest version before submitting.
          <button
            type="button"
            onClick={() => {
              setDraft(job.fields);
              setBaseFields(job.fields);
              setDraftRevision(job.revision);
              setNewer(false);
            }}
          >
            Use latest brief and discard my unsaved edit
          </button>
        </p>
      )}
      <div className="coord-state">
        <span className="coord-pill">{states[job.state]}</span>
        <span>
          Version {job.revision} · updated {date(job.updatedAt)}
        </span>
      </div>
      {closed && (
        <p className="coord-notice">
          Client access ends {date(job.archiveAt)}. The provider keeps the
          project record.
        </p>
      )}
      <nav className="coord-tabs" aria-label="Project sections">
        {["Brief", "Agreement", "Updates", "Files", "Progress"].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Updates" && issues.length ? " · " + issues.length : ""}
          </button>
        ))}
      </nav>
      {tab === "Brief" && (
        <>
          <div className="coord-summary">
            <div>
              <span>Location</span>
              <strong>{job.fields.address || "Address needed"}</strong>
            </div>
            <div>
              <span>Appointment</span>
              <strong>
                {job.fields.startLocal
                  ? job.fields.startLocal.replace("T", " ") +
                    " · " +
                    job.fields.timeZone
                  : "Not confirmed"}
              </strong>
            </div>
          </div>
          <form onSubmit={save}>
            <div
              className="coord-groups"
              role="group"
              aria-label="Brief fields"
            >
              {groups
                .filter((g) => fields.some((f) => f.group === g))
                .map((g) => (
                  <button
                    type="button"
                    key={g}
                    aria-pressed={group === g}
                    onClick={() => setGroup(g)}
                  >
                    {g}
                  </button>
                ))}
            </div>
            <div className="coord-fields">{fieldNodes}</div>
            {canEdit && (
              <button disabled={busy || !Object.keys(changed).length}>
                {needsProposal
                  ? "Propose these changes"
                  : "Save current information"}
              </button>
            )}
            {needsProposal && (
              <p>
                Agreed scope stays in effect until both sides accept this
                proposal.
              </p>
            )}
          </form>
          <details>
            <summary>Current {job.accepted ? "agreed" : "draft"} scope</summary>
            <p className="coord-pre">
              {(job.accepted || job.fields).scope || "Scope needed"}
            </p>
            <p className="coord-pre">
              {(job.accepted || job.fields).deliverables ||
                "Deliverables needed"}
            </p>
          </details>
        </>
      )}
      {tab === "Agreement" && (
        <>
          <h2>
            {job.accepted ? "Your agreed project" : "Review before confirming"}
          </h2>
          <dl className="coord-terms">
            {[
              "scope",
              "exclusions",
              "deliverables",
              "deliveryDeadline",
              "startLocal",
              "timeZone",
              "agreedFee",
              "currency",
              "paymentTerms",
            ]
              .filter((k) => job.fields[k])
              .map((k) => (
                <React.Fragment key={k}>
                  <dt>{labels[k]}</dt>
                  <dd>{(job.accepted || job.fields)[k]}</dd>
                </React.Fragment>
              ))}
          </dl>
          {job.proposal && (
            <section className="coord-notice">
              <h3>Proposed revision</h3>
              <p>
                Submitted by {job.proposal.author}. Current agreed terms remain
                active.
              </p>
              <dl className="coord-terms">
                {Object.keys(job.proposal.fields)
                  .filter(
                    (k) =>
                      job.proposal.fields[k] !== job.accepted[k] &&
                      !privateFields.has(k),
                  )
                  .map((k) => (
                    <React.Fragment key={k}>
                      <dt>{labels[k]}</dt>
                      <dd>{job.proposal.fields[k] || "Removed"}</dd>
                    </React.Fragment>
                  ))}
              </dl>
              <button
                disabled={
                  busy ||
                  !canEdit ||
                  (client
                    ? job.proposal.clientApproved
                    : job.proposal.providerApproved)
                }
                onClick={() =>
                  command(job, "accept_proposal", {
                    proposalId: job.proposal.id,
                  })
                }
              >
                {(
                  client
                    ? job.proposal.clientApproved
                    : job.proposal.providerApproved
                )
                  ? "Your approval is recorded"
                  : "Accept proposed revision"}
              </button>
              <button
                disabled={busy || !canEdit}
                onClick={() => command(job, "reject_proposal")}
              >
                Reject proposal
              </button>
            </section>
          )}
          {!job.accepted && canEdit && (
            <>
              <p>
                Provider:{" "}
                {job.providerApproved ? "approved" : "not yet approved"} ·
                Client: {job.clientApproved ? "approved" : "not yet approved"}
              </p>
              <p>
                {issues.length
                  ? issues.length +
                    " item(s) need attention in the brief or updates."
                  : "Required information is complete."}
              </p>
              {["draft", "clarification", "submitted"].includes(job.state) && (
                <button
                  disabled={busy || Object.keys(changed).length > 0}
                  onClick={() => command(job, "submit")}
                >
                  Submit current request
                </button>
              )}
              {!client && (
                <label className="coord-check">
                  <input
                    type="checkbox"
                    checked={authorized}
                    onChange={(e) => setAuthorized(e.target.checked)}
                  />
                  I authorize {price / CREDIT_UNIT} credits for this job once
                  both sides approve. Later edits and reopening carry no second
                  project charge.
                </label>
              )}
              <button
                disabled={
                  busy ||
                  issues.length > 0 ||
                  job.state === "draft" ||
                  (!client && !authorized) ||
                  Object.keys(changed).length > 0
                }
                onClick={() =>
                  command(
                    job,
                    "approve",
                    client ? {} : { authorizedMicros: price },
                  )
                }
              >
                {client
                  ? "Approve this project"
                  : "Approve & authorize job credits"}
              </button>
            </>
          )}
        </>
      )}
      {tab === "Updates" && (
        <>
          <h2>What needs attention</h2>
          {activity.length > 0 && (
            <details>
              <summary>Recent project activity</summary>
              <ol className="coord-activity">
                {activity.slice(0, 20).map((e) => (
                  <li key={e.id}>
                    <strong>{e.label}</strong>
                    <span>
                      {date(e.at)} · Revision {e.revision}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {issues
            .filter((i) => i.kind === "missing")
            .map((i) => (
              <p key={i.field}>{labels[i.field]} is required.</p>
            ))}
          {job.questions.map((q) => (
            <div className="coord-thread" key={q.id}>
              <strong>{q.text}</strong>
              {q.answer ? (
                <p>{q.answer}</p>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const answer = new FormData(e.currentTarget).get("answer");
                    await command(job, "answer", {
                      questionId: q.id,
                      text: answer,
                    });
                  }}
                >
                  <label>
                    Your answer
                    <textarea
                      name="answer"
                      rows={2}
                      required
                      maxLength={2000}
                      disabled={!canEdit || busy}
                    />
                  </label>
                  <button disabled={!canEdit || busy}>Send answer</button>
                </form>
              )}
            </div>
          ))}
          {job.updates.map((u) => (
            <div className="coord-thread" key={u.id}>
              <strong>
                {u.fields.map((k) => labels[k]).join(", ")} changed
              </strong>
              <p>
                {date(u.at)} ·{" "}
                {u.acknowledged
                  ? "Provider acknowledged"
                  : "Provider acknowledgment needed"}
              </p>
              {!client && !u.acknowledged && (
                <button
                  disabled={busy || !canEdit}
                  onClick={() =>
                    command(job, "acknowledge", { updateId: u.id })
                  }
                >
                  I’ve reviewed this update
                </button>
              )}
            </div>
          ))}
          {!client && canEdit && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await command(job, "question", { text });
                if (result) setText("");
              }}
            >
              <label>
                Ask the client to clarify
                <textarea
                  value={text}
                  maxLength={2000}
                  required
                  rows={2}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <button disabled={busy}>Send question</button>
            </form>
          )}
          {!issues.length && !job.questions.length && !job.updates.length && (
            <p>No unresolved updates.</p>
          )}
        </>
      )}
      {tab === "Files" && (
        <>
          <h2>Plans and reference files</h2>
          <p>
            PDF, JPEG or PNG, up to 512 KiB each. Files stay in the provider’s
            private Google Drive.
          </p>
          {fileError && <p role="alert">{fileError}</p>}
          <ul>
            {job.attachments
              .filter((a) => !client || a.visibility === "client")
              .map((a) => (
                <li key={a.id}>
                  <a
                    href={
                      "/api/coordination/" +
                      role +
                      "/file?id=" +
                      encodeURIComponent(a.id) +
                      (client ? "" : "&job=" + encodeURIComponent(job.id))
                    }
                  >
                    {a.name}
                  </a>
                  {!client && (
                    <span>
                      {" "}
                      ·{" "}
                      {a.visibility === "client"
                        ? "Shared with client"
                        : "Provider only"}
                    </span>
                  )}
                </li>
              ))}
          </ul>
          {canEdit && (
            <label>
              Add a reference file
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  setFileError("");
                  if (file.size > 512 * 1024) {
                    setFileError("Use a file up to 512 KiB.");
                    return;
                  }
                  try {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let content = "";
                    for (let i = 0; i < bytes.length; i += 8192)
                      content += String.fromCharCode(
                        ...bytes.slice(i, i + 8192),
                      );
                    await upload({
                      name: file.name,
                      type: file.type,
                      content: btoa(content),
                      expectedRevision: job.revision,
                      visibility: "client",
                    });
                    e.target.value = "";
                  } catch {
                    setFileError(
                      "File could not be read. Keep the original and try again.",
                    );
                  }
                }}
              />
            </label>
          )}
          {(job.fields.otherDocuments || job.fields.reference1Url) && (
            <p className="coord-pre">
              {job.fields.otherDocuments}
              <br />
              {job.fields.reference1Url}
            </p>
          )}
        </>
      )}
      {tab === "Progress" && (
        <>
          <h2>Project status</h2>
          <p>{states[job.state]}</p>
          <div className="coord-payment">
            <strong>Provider-reported payment</strong>
            <p>
              {job.fields.paidAmount
                ? job.fields.paidAmount +
                  " " +
                  job.fields.currency +
                  " recorded received" +
                  (job.fields.paidDate ? " on " + job.fields.paidDate : "")
                : "Payment receipt has not been confirmed."}
            </p>
            <span className="coord-small">
              This is the provider’s record. Bank settlement is not connected.
            </span>
          </div>
          {client && job.state === "delivered" && (
            <button
              disabled={busy || job.deliveryAccepted}
              onClick={() => command(job, "accept_delivery")}
            >
              {job.deliveryAccepted
                ? "Delivery acknowledged"
                : "Acknowledge delivery"}
            </button>
          )}
          {!client && (
            <>
              {["confirmed", "in_progress"].includes(job.state) && (
                <div className="coord-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      command(job, "progress", { state: "in_progress" })
                    }
                  >
                    Mark in progress
                  </button>
                  <button
                    disabled={busy || issues.length > 0}
                    onClick={() =>
                      command(job, "progress", { state: "delivered" })
                    }
                  >
                    Mark delivered
                  </button>
                </div>
              )}
              <label>
                {closed ? "Reason to reopen" : "Closure / cancellation reason"}
                <textarea
                  rows={2}
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="coord-actions">
                {job.state === "delivered" && (
                  <button
                    disabled={
                      busy ||
                      issues.length > 0 ||
                      (!job.deliveryAccepted && !reason.trim())
                    }
                    onClick={() => command(job, "close", { reason })}
                  >
                    Close completed job
                  </button>
                )}
                {canEdit && (
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() => command(job, "cancel", { reason })}
                  >
                    Cancel job
                  </button>
                )}
                {closed && job.state !== "archived" && (
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() => command(job, "reopen", { reason })}
                  >
                    Reopen for correction
                  </button>
                )}
                {closed && job.state !== "archived" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      command(job, "extend", {
                        until: Date.now() + 90 * 86400000,
                      })
                    }
                  >
                    Extend client access 90 days
                  </button>
                )}
                {job.state === "archived" && (
                  <button
                    disabled={busy}
                    onClick={() => command(job, "restore")}
                  >
                    Restore provider view
                  </button>
                )}
              </div>
              {invite && !closed && (
                <button disabled={busy} onClick={invite}>
                  Send a fresh client sign-in link
                </button>
              )}
              {archive && (
                <p>
                  <a
                    href={
                      "https://drive.google.com/file/d/" +
                      encodeURIComponent(archive.fileId) +
                      "/view"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open verified archive in your Google Drive
                  </a>
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
