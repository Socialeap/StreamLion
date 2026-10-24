import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppNavigation.jsx";
import { pilotRequest, pilotDate } from "./pilot-api.js";
import PilotControls from "./PilotControls.jsx";
const EMPTY = {
  onboarding: false,
  workflow: false,
  feedback: "",
  support: "",
  willingness: "unanswered",
};
export default function FreePilot() {
  const accountState = useRef({ subject: undefined, generation: 0 });
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [provider, setProvider] = useState(false),
    [terms, setTerms] = useState(false),
    [admin, setAdmin] = useState(null),
    [offset, setOffset] = useState(0),
    [feedback, setFeedback] = useState(EMPTY);
  const [form, setForm] = useState({
    name: "",
    business: "",
    fit: "",
    contact: false,
    marketing: false,
  });
  function populate(d) {
    const subject = d.subject || null;
    if (accountState.current.subject !== subject) {
      accountState.current = {
        subject,
        generation: accountState.current.generation + 1,
      };
      setFeedback(d.feedback || EMPTY);
      setForm({
        name: d.application?.name || "",
        business: d.application?.business || "",
        fit: d.application?.fit || "",
        contact: !!d.application?.contact,
        marketing: !!d.application?.marketing,
      });
      setProvider(false);
      setReady(false);
      setTerms(false);
      setAdmin(null);
      setOffset(0);
      setBusy(false);
      setError("");
      setMessage("");
    } else if (accountState.current.durationDays !== d.durationDays) {
      setReady(false);
      setTerms(false);
    }
    accountState.current.durationDays = d.durationDays;
    setData(d);
  }
  async function load(generation) {
    const d = await pilotRequest("status");
    if (
      generation !== undefined &&
      generation !== accountState.current.generation
    )
      return null;
    populate(d);
    return d;
  }
  useEffect(() => {
    let active = true;
    pilotRequest("status")
      .then((d) => {
        if (active) {
          populate(d);
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!data?.enabled || !data.connected) return;
    let live = true;
    const refresh = () => {
      const generation = accountState.current.generation;
      pilotRequest("status")
        .then((d) => {
          if (live && generation === accountState.current.generation)
            populate(d);
        })
        .catch(() => {});
    };
    const interval = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [data?.enabled, data?.connected, data?.subject]);
  useEffect(() => {
    const active = data?.active,
      invited = data?.state === "invited";
    const deadline = active ? data.endsAt : invited ? data.inviteUntil : null;
    if (!Number.isSafeInteger(deadline)) return;
    const generation = accountState.current.generation;
    const expire = () => {
      if (generation !== accountState.current.generation) return;
      setData((p) => ({
        ...p,
        active: false,
        state: active ? "expired" : "invitation_expired",
      }));
    };
    if (deadline <= Date.now()) {
      expire();
      return;
    }
    const timer = setTimeout(
      expire,
      Math.min(deadline - Date.now(), 2147483647),
    );
    return () => clearTimeout(timer);
  }, [
    data?.active,
    data?.state,
    data?.endsAt,
    data?.inviteUntil,
    data?.subject,
  ]);
  async function perform(route, body) {
    const generation = accountState.current.generation;
    const subject = data.subject;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await pilotRequest(route, {
        method: "POST",
        account: subject,
        body: JSON.stringify(body),
      });
      if (generation !== accountState.current.generation) return false;
      await load(generation);
      if (generation !== accountState.current.generation) return false;
      setMessage(
        route === "apply"
          ? "Interest registered. This does not grant access."
          : route === "activate" || route === "start"
            ? "Pilot activated. Your expiry is shown below."
            : "Saved.",
      );
      if (admin) await list(offset);
      return true;
    } catch (e) {
      if (generation !== accountState.current.generation) return false;
      setError(e.message);
      if (route === "start" || route.startsWith("admin/")) {
        try {
          const fresh = await load(generation);
          if (!fresh || generation !== accountState.current.generation)
            return false;
          if (route === "start" && fresh.active) {
            setError("");
            setMessage("Pilot activated. Your expiry is shown below.");
          } else if (
            route === "start" &&
            (e.registered || fresh.state === "applied" || fresh.application)
          )
            setMessage(
              "Your interest is saved. No pilot access has started. More pilot places are planned.",
            );
          if (admin) await list(offset, false);
        } catch {
          /* Keep the original failure visible; never infer access. */
        }
      }
      return false;
    } finally {
      if (generation === accountState.current.generation) setBusy(false);
    }
  }
  async function list(page = 0, clearError = true) {
    const generation = accountState.current.generation;
    if (clearError) setError("");
    try {
      const result = await pilotRequest("admin/list?offset=" + page);
      if (generation !== accountState.current.generation) return;
      setAdmin(result);
      setOffset(page);
    } catch (e) {
      if (generation === accountState.current.generation) setError(e.message);
    }
  }
  const canApply =
    data && ["none", "applied"].includes(data.state) && !data.startsAt;
  const canStart =
    canApply &&
    !data.active &&
    data.admissionMode === "instant" &&
    data.availability === "available";
  return (
    <div className="purchase-shell">
      <AppHeader account={data?.account || ""} />
      <main className="purchase-card free-pilot" id="main">
        <h1>StreamLion free pilot</h1>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {!data && !error && <p role="status">Checking pilot availability…</p>}
        {data?.enabled === false && <p>Pilot registration is not open.</p>}
        {data?.enabled && (
          <>
            <p>
              For spatial capture providers testing job preparation, field notes
              and handover in the standalone StreamLion app.
            </p>
            <p>
              Manual entry, Google save, saved-detail lookup, exports and device
              backup are included. Paid AI, brief preparation, hosted voice and
              client-portal automation are excluded. Device voice uses your
              browser’s own services.
            </p>
            <p>
              No card, deposit, payment obligation or automatic paid conversion.
              A later purchase would require your separate choice after sales
              approval; no purchase date or future price is promised.
            </p>
            <p>
              Your Google files remain yours after the pilot. Active workspace
              writes stop at expiry; existing Google records remain available
              for retrieval. Download a device backup before expiry and keep
              important originals. Nothing is automatically deleted or
              disconnected.
            </p>
            {!data.connected ? (
              <>
                <p>
                  Sign in with your verified Google account to register interest
                  or view an account-bound invitation. Signing in does not apply
                  or start a trial.
                </p>
                <a
                  className="purchase-primary"
                  href="/api/google/start?returnTo=%2Fpilot%2F"
                >
                  Sign in with Google
                </a>
              </>
            ) : (
              <>
                <p>
                  Signed in as <strong>{data.account}</strong>. State:{" "}
                  <strong>{data.state.replaceAll("_", " ")}</strong>.
                </p>
                {canApply && (canStart || data.interestOpen) && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        canStart &&
                        (!provider ||
                          !form.contact ||
                          !ready ||
                          !terms ||
                          !form.name.trim() ||
                          !form.fit.trim())
                      )
                        return;
                      perform(
                        canStart ? "start" : "apply",
                        canStart
                          ? {
                              ...form,
                              provider,
                              ready,
                              terms: "free-pilot-v2",
                              durationDays: data.durationDays,
                            }
                          : form,
                      );
                    }}
                  >
                    <h2>
                      {canStart
                        ? "Start your free pilot"
                        : "Join the interest list"}
                    </h2>
                    <p>
                      {canStart
                        ? `Your ${data.durationDays}-day pilot begins when activation succeeds. Start when you are ready to test a job.`
                        : data.availability === "full"
                          ? "Update: this pilot group is full. More pilot places are planned. Join the interest list for news of the next opening."
                          : "Immediate pilot admission is unavailable. You can register interest; this does not promise access or an approval date."}
                    </p>
                    <p>
                      Provide only business fit and contact details. Do not
                      include client documents, site information or sensitive
                      data.
                    </p>
                    <label>
                      Your name
                      <input
                        required
                        maxLength={100}
                        autoComplete="name"
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Business or role (optional)
                      <input
                        maxLength={100}
                        value={form.business}
                        onChange={(e) =>
                          setForm({ ...form, business: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      How would you test a useful capture job workflow?
                      <textarea
                        required
                        maxLength={500}
                        value={form.fit}
                        onChange={(e) =>
                          setForm({ ...form, fit: e.target.value })
                        }
                      />
                    </label>
                    <label className="pilot-check">
                      <input
                        type="checkbox"
                        required
                        checked={form.contact}
                        onChange={(e) =>
                          setForm({ ...form, contact: e.target.checked })
                        }
                      />
                      Contact me about this pilot application using my Google
                      account email. Required to apply.
                    </label>
                    <label className="pilot-check">
                      <input
                        type="checkbox"
                        checked={form.marketing}
                        onChange={(e) =>
                          setForm({ ...form, marketing: e.target.checked })
                        }
                      />
                      Optional: send me StreamLion marketing updates.
                    </label>
                    <p>
                      We keep your verified account identity, application,
                      consent choices, admission dates and feedback for pilot
                      operations. Contact{" "}
                      <a href="mailto:info@transcendencemedia.com">support</a>{" "}
                      to withdraw consent or request deletion; minimum
                      abuse-prevention and access records may need to remain.
                      Marketing is optional and never affects admission. See the{" "}
                      <a href="/api/privacy">privacy policy</a>.
                    </p>
                    {canStart && (
                      <>
                        <label className="pilot-check">
                          <input
                            type="checkbox"
                            required
                            checked={provider}
                            onChange={(e) => setProvider(e.target.checked)}
                          />
                          I am a professional spatial capture provider.
                        </label>
                        <label className="pilot-check">
                          <input
                            type="checkbox"
                            required
                            checked={ready}
                            onChange={(e) => setReady(e.target.checked)}
                          />
                          I am ready to test a useful job workflow now.
                        </label>
                        <label className="pilot-check">
                          <input
                            type="checkbox"
                            required
                            checked={terms}
                            onChange={(e) => setTerms(e.target.checked)}
                          />
                          I accept the free pilot terms (free-pilot-v2),
                          including expiry and data handling described above.
                        </label>
                      </>
                    )}
                    <button
                      className="purchase-primary"
                      disabled={
                        busy ||
                        (canStart &&
                          (!provider ||
                            !form.contact ||
                            !ready ||
                            !terms ||
                            !form.name.trim() ||
                            !form.fit.trim()))
                      }
                    >
                      {canStart ? "Start my free pilot" : "Register interest"}
                    </button>
                  </form>
                )}
                {canApply && !canStart && !data.interestOpen && (
                  <p>Interest registration is closed.</p>
                )}
                {["applied", "approved"].includes(data.state) && !canStart && (
                  <p>
                    Your interest is recorded.{" "}
                    {data.admissionMode === "instant"
                      ? "More pilot places are planned. No access has started and no opening date is guaranteed."
                      : "Admission and invitation require owner review. No access has started and no approval date is guaranteed."}
                  </p>
                )}
                {data.state === "invited" && (
                  <section>
                    <h2>Activate when you are ready</h2>
                    <p>
                      This invitation is only for the signed-in account.
                      Activate before {pilotDate(data.inviteUntil)}. Your{" "}
                      {data.invitedDurationDays}-day clock begins when
                      activation succeeds.
                    </p>
                    <p>
                      Check your Google connection and availability to test a
                      job before continuing. Save or export work before expiry.
                      An extension requires explicit owner approval.
                    </p>
                    <label className="pilot-check">
                      <input
                        type="checkbox"
                        checked={ready}
                        onChange={(e) => setReady(e.target.checked)}
                      />
                      I am ready to begin and accept these free pilot terms
                      (free-pilot-v1), including the expiry and data handling
                      described above.
                    </label>
                    <button
                      className="purchase-primary"
                      disabled={busy || !ready}
                      onClick={() =>
                        perform("activate", { ready, terms: "free-pilot-v1" })
                      }
                    >
                      Activate my pilot
                    </button>
                  </section>
                )}
                {data.startsAt && (
                  <section>
                    <h2>Pilot access</h2>
                    <p>
                      Started: {pilotDate(data.startsAt)}
                      <br />
                      Expires: <strong>{pilotDate(data.endsAt)}</strong>
                    </p>
                    {data.active ? (
                      <a className="purchase-primary" href="/?page=Projects">
                        Open workspace
                      </a>
                    ) : (
                      <p>
                        Active pilot access has ended. No charge or automatic
                        extension occurs.
                      </p>
                    )}
                    <p>
                      <a href="https://drive.google.com/drive/my-drive">
                        Retrieve your Google-owned files
                      </a>{" "}
                      · <a href="/api/purchase">Download a device backup</a>
                    </p>
                    <h2>Optional pilot feedback</h2>
                    <p>
                      No testimonial or purchase commitment is required. Do not
                      include customer or site details. These are
                      participant-reported outcomes, not verified usage or
                      sales.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        perform("feedback", feedback);
                      }}
                    >
                      <label className="pilot-check">
                        <input
                          type="checkbox"
                          checked={feedback.onboarding}
                          onChange={(e) =>
                            setFeedback({
                              ...feedback,
                              onboarding: e.target.checked,
                            })
                          }
                        />
                        I completed onboarding.
                      </label>
                      <label className="pilot-check">
                        <input
                          type="checkbox"
                          checked={feedback.workflow}
                          onChange={(e) =>
                            setFeedback({
                              ...feedback,
                              workflow: e.target.checked,
                            })
                          }
                        />
                        I completed a useful job workflow.
                      </label>
                      <label>
                        Feedback
                        <textarea
                          maxLength={1000}
                          value={feedback.feedback}
                          onChange={(e) =>
                            setFeedback({
                              ...feedback,
                              feedback: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Errors or support needed
                        <textarea
                          maxLength={1000}
                          value={feedback.support}
                          onChange={(e) =>
                            setFeedback({
                              ...feedback,
                              support: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Would you consider paying if sales later open?
                        <select
                          value={feedback.willingness}
                          onChange={(e) =>
                            setFeedback({
                              ...feedback,
                              willingness: e.target.value,
                            })
                          }
                        >
                          <option value="unanswered">
                            Prefer not to answer
                          </option>
                          <option value="yes">Yes</option>
                          <option value="maybe">Maybe</option>
                          <option value="no">No</option>
                        </select>
                      </label>
                      <button disabled={busy}>Save optional feedback</button>
                    </form>
                  </section>
                )}
                {["revoked", "invitation_expired"].includes(data.state) &&
                  !data.startsAt && (
                    <p>
                      This invitation is no longer available. Contact the owner
                      for review; a new trial is not granted automatically.
                    </p>
                  )}
                {data.admin && (
                  <section>
                    <h2>Pilot administration</h2>
                    <button onClick={() => list(0)}>Review applications</button>
                    {admin && (
                      <>
                        <PilotControls
                          available={admin.controlsAvailable === true}
                          policy={admin.policy}
                          counts={admin.counts}
                          busy={busy}
                          perform={perform}
                        />
                        <p>
                          Applications: {admin.counts.applications} · Cumulative
                          admissions: {admin.counts.admissions || 0}/
                          {admin.policy.admission_cap} · Active:{" "}
                          {admin.counts.active || 0} · Reserved:{" "}
                          {admin.counts.reserved || 0} · Simultaneous cap:{" "}
                          {admin.policy.active_cap}
                        </p>
                        <p>
                          Reported onboarding: {admin.counts.onboarded || 0} ·
                          Reported useful workflows:{" "}
                          {admin.counts.workflows || 0}. Purchases are recorded
                          separately in the existing payment ledger.
                        </p>
                        <p>
                          Pilot metered-feature allowance: $0. {admin.costBasis}{" "}
                          Check Cloudflare usage separately; this is not a
                          measured infrastructure bill.
                        </p>
                        {admin.accounts.map((row) => (
                          <AdminAccount
                            key={row.google_subject}
                            row={row}
                            busy={busy}
                            perform={perform}
                          />
                        ))}
                        {offset > 0 && (
                          <button
                            onClick={() => list(Math.max(0, offset - 50))}
                          >
                            Previous applications
                          </button>
                        )}
                        {admin.nextOffset !== null && (
                          <button onClick={() => list(admin.nextOffset)}>
                            Next applications
                          </button>
                        )}
                      </>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}
        <p>
          <a href="/api/welcome">About StreamLion</a> ·{" "}
          <a href="/api/support">Support</a>
        </p>
      </main>
    </div>
  );
}
function AdminAccount({ row, busy, perform }) {
  const [action, setAction] = useState("approve"),
    [reason, setReason] = useState(""),
    [end, setEnd] = useState("");
  return (
    <article className="pilot-account">
      <h3>
        {row.name} · {row.email}
      </h3>
      <p>
        {row.business} · {row.fit}
      </p>
      <p>
        State: {row.state}. Applied: {pilotDate(row.applied_at)}. Invitation
        deadline: {pilotDate(row.invite_until)}. Activated:{" "}
        {pilotDate(row.starts_at)}. Expiry: {pilotDate(row.ends_at)}.
      </p>
      <p>
        Optional marketing permission: {row.marketing ? "Yes" : "No"}. Reported
        onboarding: {row.onboarding ? "Yes" : "No"}. Useful workflow:{" "}
        {row.workflow ? "Yes" : "No"}. Willingness: {row.willingness}.
      </p>
      <p>
        Feedback: {row.feedback || "None"}. Support: {row.support || "None"}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          perform("admin/" + action, {
            subject: row.google_subject,
            reason,
            ...(action === "extend" ? { endsAt: Date.parse(end) } : {}),
          });
        }}
      >
        <label>
          Action for {row.email}
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="approve">Approve and reserve place</option>
            <option value="invite">Prepare account invitation</option>
            <option value="extend">Extend active expiry</option>
            <option value="revoke">Revoke</option>
          </select>
        </label>
        {action === "extend" && (
          <label>
            New expiry (UTC, including Z)
            <input
              type="text"
              required
              placeholder="2026-11-15T18:00:00Z"
              pattern=".*Z"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        )}
        <label>
          Reason for {row.email}
          <input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button disabled={busy}>Apply selected action</button>
      </form>
      <p>
        Preparing an invitation sends no message. After approval, the owner may
        manually share the <a href="/pilot/">pilot account page</a> with this
        account. It grants no access to another account.
      </p>
    </article>
  );
}
