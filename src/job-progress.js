// Milestones for a client's status page, from states the job actually
// records. Nothing is shown as done until the workflow says so.
const ORDER = {
  draft: 0,
  submitted: 1,
  clarification: 1,
  awaiting_agreement: 1,
  activation_pending: 2,
  confirmed: 2,
  in_progress: 3,
  work_completed: 4,
  delivery_pending: 4,
  delivered: 5,
  closed: 5,
};
const STOPPED = {
  cancelled: "This request was cancelled.",
  declined: "The provider declined this request.",
  expired: "This request expired before it was agreed.",
};
function visit(fields = {}) {
  if (fields.appointmentStatus !== "confirmed" || !fields.startLocal)
    return null;
  const [date, time] = fields.startLocal.split("T");
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
  return `${day} at ${time}${fields.timeZone ? ` (${fields.timeZone})` : ""}`;
}
// → { stopped, steps: [{ label, detail, state: "done" | "current" | "next" }] }
export function jobMilestones(job) {
  if (STOPPED[job.state]) return { stopped: STOPPED[job.state], steps: [] };
  const reached = ORDER[job.state];
  if (reached === undefined) return { stopped: "", steps: [] };
  const booked = visit(job.fields);
  const done = [
    reached >= 1,
    reached >= 2,
    Boolean(booked),
    reached >= 4,
    reached >= 5,
  ];
  const steps = [
    {
      label: "Request sent",
      detail:
        job.state === "clarification"
          ? "The provider asked for clarification"
          : "",
    },
    {
      label: "Brief agreed",
      detail: job.state === "awaiting_agreement" ? "Waiting for approval" : "",
    },
    { label: "Visit scheduled", detail: booked || "" },
    {
      label: "Capture complete",
      detail: job.state === "in_progress" ? "Work in progress" : "",
    },
    { label: "Results delivered", detail: "" },
  ];
  // Work that moved past the visit without a confirmed appointment never
  // claims a visit was scheduled; that milestone is left out.
  const skipVisit = !booked && reached >= 4;
  const kept = steps
    .map((step, i) => ({ step, done: done[i] }))
    .filter((_, i) => !(skipVisit && i === 2));
  const current = kept.findIndex((item) => !item.done);
  return {
    stopped: "",
    steps: kept.map(({ step, done: finished }, i) => ({
      ...step,
      state: finished ? "done" : i === current ? "current" : "next",
    })),
  };
}
