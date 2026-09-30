import { legacyFields, intakeFor } from "./project-schema.js";

// A versioned observation uses the existing workbook headers and revision rules.
export const WORKFLOW_AREA = "StreamLion project checklist";
const KIND = "streamlion.workflow";
const STATES = ["todo", "done", "blocked", "not-needed"];
export const VISIT_STATES = ["not-started", "in-progress", "captured"];
export const DELIVERY_STATES = ["not-sent", "sent", "accepted"];

export function scopeSignature(project) {
  const source = JSON.stringify([
    project.scope || "",
    project.exclusions || "",
    project.deliverables || "",
  ]);
  let hash = 2166136261;
  for (const char of source)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return String(hash >>> 0);
}

export function validateWorkflow(value) {
  if (
    !value ||
    value.kind !== KIND ||
    value.version !== 1 ||
    !VISIT_STATES.includes(value.visit) ||
    !DELIVERY_STATES.includes(value.delivery) ||
    !Array.isArray(value.requirements) ||
    value.requirements.length > 40
  )
    throw new Error(
      "This checklist format is not supported. Keep the original record and contact support.",
    );
  const ids = new Set();
  for (const item of value.requirements) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[\w-]{1,100}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.label !== "string" ||
      !item.label.trim() ||
      item.label.length > 500 ||
      typeof item.area !== "string" ||
      item.area.length > 200 ||
      !STATES.includes(item.state) ||
      typeof item.reason !== "string" ||
      item.reason.length > 1000 ||
      !Array.isArray(item.evidence) ||
      item.evidence.length > 20 ||
      item.evidence.some(
        (id) => typeof id !== "string" || !/^[\w-]{1,100}$/.test(id),
      )
    )
      throw new Error(
        "Check the requirement, area, and evidence before saving.",
      );
    if (["blocked", "not-needed"].includes(item.state) && !item.reason.trim())
      throw new Error("Explain why this requirement is blocked or not needed.");
    ids.add(item.id);
  }
  for (const key of [
    "scopeSignature",
    "deliveredAt",
    "acceptedAt",
    "templateName",
    "siteLessons",
  ])
    if (
      typeof value[key] !== "string" ||
      value[key].length > (key === "siteLessons" ? 2000 : 200)
    )
      throw new Error("Invalid checklist details.");
  if (JSON.stringify(value).length > 11500)
    throw new Error(
      "This checklist is full. Shorten the descriptions before saving; nothing has been discarded.",
    );
  return value;
}

export function workflowNote(notes, projectId) {
  const matches = notes.filter(
    (note) => note.jobId === projectId && note.area === WORKFLOW_AREA,
  );
  if (matches.length > 1)
    throw new Error(
      "More than one checklist exists for this project. Review the records before editing.",
    );
  return matches[0];
}

export function readWorkflow(notes, project) {
  const note = workflowNote(notes, project.id);
  if (note) {
    let value;
    try {
      value = JSON.parse(note.text);
    } catch {
      throw new Error(
        "The saved checklist could not be read. Its original record has been kept.",
      );
    }
    return validateWorkflow(value);
  }
  return {
    kind: KIND,
    version: 1,
    requirements: [],
    visit: "not-started",
    delivery: "not-sent",
    scopeSignature: scopeSignature(project),
    deliveredAt: "",
    acceptedAt: "",
    templateName: "",
    siteLessons: "",
  };
}

export function requirementsFromBrief(project) {
  const lines = (project.deliverables || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 40 || lines.some((line) => line.length > 500))
    throw new Error(
      "The brief needs a shorter checklist. Add the requirements individually; the full brief stays in project details.",
    );
  return lines.map((label) => ({
    id: crypto.randomUUID(),
    label,
    area: "",
    state: "todo",
    reason: "",
    evidence: [],
  }));
}

export function beforeLeaving(project, plan, notes) {
  const items = plan.requirements
    .filter((item) => item.state === "todo" || item.state === "blocked")
    .map((item) => ({
      label: item.label,
      detail: item.state === "blocked" ? item.reason : "Not yet checked",
      state: item.state,
    }));
  if (!plan.requirements.length)
    items.push({
      label: "Confirm the requested work",
      detail: "No checklist has been prepared yet.",
      state: "todo",
    });
  if (plan.scopeSignature !== scopeSignature(project))
    items.push({
      label: "Review the changed brief",
      detail:
        "The scope or requested outputs changed after this checklist was prepared.",
      state: "todo",
    });
  const pending = notes.filter(
    (note) =>
      note.jobId === project.id &&
      note.area !== WORKFLOW_AREA &&
      (!note.reviewed || note.pendingBookId),
  );
  if (pending.length)
    items.push({
      label: `${pending.length} field record${pending.length === 1 ? "" : "s"} to check`,
      detail:
        "Review the notes, recordings, and anything waiting to reach Google.",
      state: "todo",
    });
  for (const item of plan.requirements) {
    if (
      item.evidence.some(
        (id) =>
          !notes.some((note) => note.id === id && note.jobId === project.id),
      )
    )
      items.push({
        label: `Check evidence for ${item.label}`,
        detail: "An attached field record is unavailable in this view.",
        state: "todo",
      });
  }
  return items;
}

export function paymentSummary(project) {
  const amount = (value) =>
    typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)
      ? Math.round(Number(value) * 100)
      : null;
  const invoiced = amount(project.invoiceAmount),
    paid = amount(project.paidAmount);
  const format = (cents) => {
    if (cents == null || !project.currency) return "Not recorded";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: project.currency,
      }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${project.currency}`;
    }
  };
  return {
    agreed: format(amount(project.agreedFee)),
    invoiced: format(invoiced),
    received: format(paid),
    outstanding:
      invoiced == null || paid == null
        ? "Not enough information"
        : format(Math.max(0, invoiced - paid)),
    overpaid: invoiced != null && paid != null && paid > invoiced,
  };
}

export function progressLabel(plan) {
  if (plan.delivery === "accepted") return "Accepted";
  if (plan.delivery === "sent") return "Delivered";
  if (plan.visit === "captured") return "Capture recorded";
  if (plan.visit === "in-progress") return "On site";
  return "Preparation";
}

export function deliverySummary(project, plan, notes) {
  const fieldNotes = notes.filter(
    (note) => note.jobId === project.id && note.area !== WORKFLOW_AREA,
  );
  return [
    `${project.title} — delivery summary`,
    `Project reference: ${project.reference || "Not recorded"}`,
    `Site: ${[project.address, project.address2, project.city, project.region].filter(Boolean).join(", ") || "Not recorded"}`,
    `Requested outputs: ${project.deliverables || "Confirm with the customer"}`,
    `Delivery destination: ${project.deliveryDestination || "Confirm with the customer"}`,
    `Delivery deadline: ${project.deliveryDeadline || "Not recorded"}`,
    "",
    "Work accounted for:",
    ...plan.requirements.map(
      (item) =>
        `- ${item.label}${item.area ? ` (${item.area})` : ""}: ${item.state === "done" ? "Checked by provider" : item.state === "todo" ? "Not yet checked" : item.state}${item.reason ? ` — ${item.reason}` : ""}${item.evidence.length ? `\n  Evidence: ${item.evidence.map((id) => fieldNotes.find((note) => note.id === id)?.area || "Unavailable field record").join(", ")}` : ""}`,
    ),
    "",
    `Site findings / agreed exceptions: ${plan.siteLessons || "Not recorded"}`,
    "",
    "Field findings:",
    ...fieldNotes.map(
      (note) =>
        `- ${note.area}${note.reviewed ? " (reviewed)" : " (needs review)"}${note.pendingBookId ? " — waiting to reach Google" : ""}: ${note.text}${note.sourceText && note.sourceText !== note.text ? `\n  Original wording: ${note.sourceText}` : ""}`,
    ),
    "",
    "Files and references:",
    ...["document", "reference"].flatMap((kind) =>
      [1, 2].flatMap((index) =>
        project[`${kind}${index}Url`]
          ? [
              `${project[`${kind}${index}Name`] || `${kind} ${index}`}: ${project[`${kind}${index}Url`]}`,
            ]
          : [],
      ),
    ),
    ...(project.driveFolderUrl
      ? [`Project folder: ${project.driveFolderUrl}`]
      : []),
    ...fieldNotes
      .filter((note) => note.audioUrl)
      .map((note) => `${note.area}: ${note.audioUrl}`),
    "",
    `Delivery: ${plan.delivery === "not-sent" ? "Not recorded as sent" : plan.delivery}${plan.deliveredAt ? ` (${plan.deliveredAt})` : ""}`,
    ...(plan.acceptedAt ? [`Acceptance recorded: ${plan.acceptedAt}`] : []),
    "Checked requirements describe the provider's record, not an automatic verification of scan quality.",
  ].join("\n");
}

export function reusableFields(project, clientOnly = false) {
  const fields = legacyFields(project);
  const copy = {};
  const keys = clientOnly
    ? [
        "companyName",
        "scope",
        "exclusions",
        "deliverables",
        "deliveryDestination",
        "paymentTerms",
        "currency",
      ]
    : [
        "title",
        "companyName",
        "address",
        "address2",
        "city",
        "region",
        "postal",
        "country",
        "contact1Name",
        "contact1Phone",
        "contact2Name",
        "contact2Phone",
        "requesterName",
        "requesterEmail",
        "providerName",
        "providerEmail",
        "timeZone",
        "scope",
        "exclusions",
        "deliverables",
        "accessInstructions",
        "paymentTerms",
        "currency",
        "driveFolderUrl",
      ];
  for (const key of keys) copy[key] = fields[key] || "";
  if (!clientOnly) copy.title = `${project.title} — repeat visit`;
  return copy;
}

export function projectContext(project, plan, notes, at) {
  return {
    ...intakeFor(legacyFields(project)),
    contextAsOf: at || "Time not recorded",
    snapshotOnly: true,
    workflow: plan,
    fieldNotes: notes
      .filter(
        (note) => note.jobId === project.id && note.area !== WORKFLOW_AREA,
      )
      .map((note) => ({
        area: note.area,
        text: note.text,
        originalText: note.sourceText || note.text,
        audioOrPhotoLink: note.audioUrl || "",
        waitingForGoogle: !!note.pendingBookId,
      })),
  };
}
