import { paymentSummary } from "./workflow.js";
import { PROJECT_FIELDS } from "./project-schema.js";

const labels = Object.fromEntries(
  PROJECT_FIELDS.map(({ key, label }) => [key, label]),
);
export const ANSWER_TOPICS = [
  {
    id: "address",
    label: "Address",
    fields: ["address", "address2", "city", "region", "postal", "country"],
    matches: /\b(address|location|where is|where s|where do i go)\b/,
  },
  {
    id: "contact",
    label: "Site contact",
    fields: ["contact1Name", "contact1Phone", "contact2Name", "contact2Phone"],
    matches:
      /\b(contact|contacts|who do i call|who should i call|phone|telephone)\b/,
  },
  {
    id: "access",
    label: "Access",
    fields: ["accessInstructions"],
    matches:
      /\b(access|entry|enter|entrance|parking|door code|lockbox|keys|key)\b|\b(get|getting) (in|into)\b/,
  },
  {
    id: "visit",
    label: "Visit",
    fields: [
      "startLocal",
      "endLocal",
      "timeZone",
      "appointmentStatus",
      "proposedTimes",
    ],
    matches:
      /\b(visit|appointment|schedule|start time|end time|arrival|when do i|when should i|what time|when is)\b/,
  },
  {
    id: "work",
    label: "Requested work",
    fields: ["scope", "exclusions"],
    matches: /\b(scope|capture|scan|scanning|work|exclusions|excluded)\b/,
  },
  {
    id: "outputs",
    label: "Deliverables",
    fields: ["deliverables", "deliveryDeadline", "deliveryDestination"],
    matches:
      /\b(deliver|delivery|deliverables|deadline|outputs|handover|hand over)\b/,
  },
  {
    id: "payment",
    label: "Payment",
    fields: [
      "offeredFee",
      "agreedFee",
      "currency",
      "invoiceAmount",
      "paidAmount",
      "paidDate",
      "dueDate",
      "paymentTerms",
    ],
    matches:
      /\b(pay|paid|payment|payments|fee|fees|invoice|invoiced|owed|outstanding|money|due)\b/,
  },
];

function answerTopic(project, topic) {
  const lines = topic.fields
    .filter((key) => String(project[key] ?? "").trim())
    .map((key) => `${labels[key]}: ${project[key]}`);
  if (topic.id === "visit" && !project.startLocal)
    lines.unshift(
      "Visit start: not recorded. Proposed availability is not a confirmed appointment.",
    );
  if (topic.id === "payment") {
    const pay = paymentSummary(project);
    lines.push(`Outstanding invoice balance: ${pay.outstanding}`);
    if (pay.overpaid)
      lines.push(
        "Recorded receipts exceed the invoice amount; check the payment records.",
      );
  }
  return {
    topic: topic.id,
    title: topic.label,
    text: lines.length
      ? lines.join("\n")
      : `${topic.label}: not recorded for this project.`,
    sources: topic.fields
      .filter((key) => String(project[key] ?? "").trim())
      .map((key) => labels[key]),
  };
}

// Deliberately bounded lookup, not an LLM. Never execute instructions, infer
// measurements, evaluate a condition, or claim to have changed a record.
export function answerProjectQuestion(project, question, topicId) {
  if (!project)
    return {
      kind: "unsupported",
      answers: [],
      message: "Choose a project first.",
    };
  const text = String(question || "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!topicId && (!text || text.length > 500)) return unsupported();
  if (
    !topicId &&
    /\b(why|recommend|calculate|compare|estimate|measurement|measurements|dimension|dimensions|wide|width|length|height|area|square|volume|safe|save|delete|update|change|other|another|all projects|should|could|would|if|not|except|ignore)\b/.test(
      text,
    )
  )
    return unsupported();
  const topics = ANSWER_TOPICS.filter((topic) =>
    topicId ? topic.id === topicId : topic.matches.test(text),
  );
  if (!topics.length || topics.length > 3) return unsupported();
  return {
    kind: "answer",
    answers: topics.map((topic) => answerTopic(project, topic)),
    message: "",
  };
}

function unsupported() {
  return {
    kind: "unsupported",
    answers: [],
    message:
      "I can look up this project's address, site contact, access, visit, requested work, deliverables, and payment. Try one of those, or use the ChatGPT handoff on Ask for a broader question.",
  };
}

export function answerSourceLabel(source, asOf) {
  if (source === "google")
    return `Google workbook · last read ${asOf || "time not recorded"}`;
  if (source === "copy")
    return `Saved Google copy · last read ${asOf || "time not recorded"}. Reconnect and refresh for changes.`;
  return "Saved on this device · not verified against Google";
}
