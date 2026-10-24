import { useEffect, useState } from "react";
import { pilotDate } from "./pilot-api.js";

const utcInput = (value) =>
  Number.isSafeInteger(value) ? new Date(value).toISOString().slice(0, 16) : "";
// datetime-local is deliberately a UTC wall time here, never the browser timezone.
function utcMillis(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const parsed = Date.parse(value + ":00Z");
  return Number.isFinite(parsed) && utcInput(parsed) === value ? parsed : NaN;
}
function fromPolicy(p) {
  return {
    activeCap: p.active_cap,
    admissionCap: p.admission_cap,
    durationDays: p.duration_days,
    applicationStart: utcInput(p.application_start),
    applicationEnd: utcInput(p.application_end),
    closesAt: utcInput(p.closes_at),
    interestOpen: !!p.interest_open,
    admissionsOpen: !!p.admissions_open,
    admissionMode: p.admission_mode || "manual",
  };
}
export default function PilotControls({
  policy,
  counts,
  busy,
  perform,
  available = true,
}) {
  const [form, setForm] = useState(() => fromPolicy(policy));
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => utcInput(policy.reopen_at));
  const [slots, setSlots] = useState(policy.reopen_slots || 1);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setForm(fromPolicy(policy));
    setDate(utcInput(policy.reopen_at));
    setSlots(policy.reopen_slots || 1);
    setConfirmed(false);
    setError("");
  }, [policy]);
  const change = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  function send(action, extra = {}) {
    setError("");
    return perform("admin/" + action, {
      revision: policy.revision,
      ...extra,
      reason:
        reason.trim() ||
        {
          settings: "Owner updated pilot capacity and availability settings.",
          schedule: "Owner scheduled a one-time addition of pilot places.",
          pause:
            "Owner paused admissions and cancelled the scheduled addition.",
          "cancel-schedule":
            "Owner cancelled the scheduled addition of pilot places.",
        }[action],
    });
  }
  function settings(e) {
    e.preventDefault();
    const applicationStart = utcMillis(form.applicationStart),
      applicationEnd = utcMillis(form.applicationEnd),
      closesAt = utcMillis(form.closesAt);
    if (
      ![applicationStart, applicationEnd, closesAt].every(Number.isSafeInteger)
    ) {
      setError("Enter a valid UTC date and time for every window field.");
      return;
    }
    if (
      applicationStart >= applicationEnd ||
      applicationEnd + Number(form.durationDays) * 86400000 > closesAt
    ) {
      setError(
        "The application window must end after it starts and leave the full pilot duration before closing.",
      );
      return;
    }
    if (
      ![Number(form.activeCap), Number(form.admissionCap)].every(
        (v) => Number.isInteger(v) && v >= 1 && v <= 20,
      ) ||
      Number(form.admissionCap) < (counts.admissions || 0) ||
      Number(form.activeCap) > Number(form.admissionCap) ||
      (form.admissionsOpen &&
        Number(form.admissionCap) + (policy.reopen_slots || 0) > 20)
    ) {
      setError(
        "Limits must be 1–20, the active limit cannot exceed the total, and the total must cover cumulative admissions. Open admissions must keep any scheduled addition within 20.",
      );
      return;
    }
    send("settings", {
      ...form,
      activeCap: Number(form.activeCap),
      admissionCap: Number(form.admissionCap),
      durationDays: Number(form.durationDays),
      applicationStart,
      applicationEnd,
      closesAt,
    });
  }
  function schedule(e) {
    e.preventDefault();
    const reopenAt = utcMillis(date),
      n = Number(slots);
    if (
      !Number.isInteger(n) ||
      n < 1 ||
      n > 20 ||
      n + policy.admission_cap > 20
    ) {
      setError(
        "Additional places must be a whole number and keep the total admission limit at 20 or below.",
      );
      return;
    }
    if (
      !confirmed ||
      !Number.isSafeInteger(reopenAt) ||
      reopenAt <= Date.now() ||
      reopenAt < policy.application_start ||
      reopenAt >= policy.application_end ||
      reopenAt + policy.duration_days * 86400000 >= policy.closes_at
    ) {
      setError(
        "Confirm a valid future UTC time inside the saved application window with the full pilot duration remaining.",
      );
      return;
    }
    send("schedule", { reopenAt, slots: n });
  }
  return (
    <section
      className="pilot-controls"
      aria-labelledby="pilot-controls-heading"
    >
      <h3 id="pilot-controls-heading">Pilot places and opening</h3>
      <p>
        Current active: {counts.active || 0} · Reserved: {counts.reserved || 0}{" "}
        · Active limit: {policy.active_cap}.
      </p>
      <p>
        Cumulative admissions: {counts.admissions || 0} / {policy.admission_cap}
        . This total never resets. Capacity changes do not remove existing
        access.
      </p>
      {!available ? (
        <p>
          Policy controls are unavailable until the required backend migration
          is verified. Admissions remain governed by the saved policy.
        </p>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          <p>
            All dates below are UTC. Enter UTC time directly; your device’s
            timezone is not used. Changes take effect only after saving.
          </p>
          <form onSubmit={settings}>
            <div className="pilot-controls-grid">
              <label>
                Maximum active places
                <input
                  type="number"
                  required
                  min="1"
                  max="20"
                  value={form.activeCap}
                  onChange={(e) => change("activeCap", e.target.value)}
                />
              </label>
              <label>
                Total admission limit
                <input
                  type="number"
                  required
                  min={Math.max(1, counts.admissions || 0)}
                  max="20"
                  value={form.admissionCap}
                  onChange={(e) => change("admissionCap", e.target.value)}
                />
              </label>
            </div>
            <details
              open={
                !Number.isSafeInteger(policy.application_start) ||
                !Number.isSafeInteger(policy.application_end) ||
                !Number.isSafeInteger(policy.closes_at)
              }
            >
              <summary>Pilot setup and availability</summary>
              <div className="pilot-controls-grid">
                <label>
                  Pilot duration
                  <select
                    value={form.durationDays}
                    onChange={(e) => change("durationDays", e.target.value)}
                  >
                    <option value="7">7 days</option>
                    <option value="14">14 days</option>
                  </select>
                </label>
                <label>
                  Admission mode
                  <select
                    value={form.admissionMode}
                    onChange={(e) => change("admissionMode", e.target.value)}
                  >
                    <option value="manual">Manual invitation</option>
                    <option value="instant">Immediate self-start</option>
                  </select>
                </label>
                <label>
                  Applications start (UTC)
                  <input
                    type="datetime-local"
                    required
                    value={form.applicationStart}
                    onChange={(e) => change("applicationStart", e.target.value)}
                  />
                </label>
                <label>
                  Applications close (UTC)
                  <input
                    type="datetime-local"
                    required
                    value={form.applicationEnd}
                    onChange={(e) => change("applicationEnd", e.target.value)}
                  />
                </label>
                <label>
                  Pilot access closes (UTC)
                  <input
                    type="datetime-local"
                    required
                    value={form.closesAt}
                    onChange={(e) => change("closesAt", e.target.value)}
                  />
                </label>
              </div>
              <label>
                Policy note (optional)
                <input
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </details>
            <label className="pilot-check">
              <input
                type="checkbox"
                checked={form.interestOpen}
                onChange={(e) => change("interestOpen", e.target.checked)}
              />
              Interest list open
            </label>
            <label className="pilot-check">
              <input
                type="checkbox"
                checked={form.admissionsOpen}
                onChange={(e) => change("admissionsOpen", e.target.checked)}
              />
              Admissions open within the saved window
            </label>
            <p>
              Turning admissions off also cancels the scheduled addition when
              you save.
            </p>
            <button disabled={busy}>Save pilot settings</button>
          </form>
          <h4>Add places once on a date</h4>
          <p>
            This raises the total admission limit once. The active limit still
            applies. It does not admit or notify anyone automatically.
            Admissions must be open when the addition is due.
          </p>
          <p>
            Scheduled addition:{" "}
            {policy.reopen_at
              ? `${policy.reopen_slots} places on ${pilotDate(policy.reopen_at)}`
              : "None"}
            .
          </p>
          <form onSubmit={schedule}>
            <div className="pilot-controls-grid">
              <label>
                Additional places
                <input
                  type="number"
                  required
                  min="1"
                  max="20"
                  value={slots}
                  onChange={(e) => {
                    setSlots(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                Add places on (UTC)
                <input
                  type="datetime-local"
                  required
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
            </div>
            <label className="pilot-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm this future UTC date and one-time addition
              {policy.reopen_at ? ", replacing the existing schedule" : ""}.
            </label>
            <button disabled={busy || !confirmed}>
              Schedule one-time addition
            </button>
          </form>
          <div className="pilot-control-actions">
            <button
              disabled={busy || !policy.reopen_at}
              onClick={() => send("cancel-schedule")}
            >
              Cancel scheduled addition only
            </button>
            <button disabled={busy} onClick={() => send("pause")}>
              Pause admissions and cancel schedule
            </button>
          </div>
          <p>
            Pause closes admissions and cancels any scheduled addition.
            Cancelling only the schedule leaves the opening switches unchanged.
            Stale changes are rejected; review refreshed settings before trying
            again.
          </p>
        </>
      )}
    </section>
  );
}
