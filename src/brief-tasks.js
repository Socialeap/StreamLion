// Local, conservative suggestions. Source wording always travels with the task;
// a provider reviews the suggestions before they become the working checklist.
export const TASK_KINDS = ["capture", "measurement", "delivery", "review"];
import { MEASUREMENT_LABELS } from "./measurements.js";
export const READINGS = MEASUREMENT_LABELS;
const normalized = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");

export function validateTaskDetails(item) {
  if (item.kind !== undefined && !TASK_KINDS.includes(item.kind))
    throw new Error("Choose a supported work requirement.");
  if (item.reading !== undefined && !READINGS.includes(item.reading))
    throw new Error("Choose the requested measurement.");
  if (item.kind === "measurement" && (!item.area?.trim() || !item.reading))
    throw new Error(
      "Name the space and reading for a measurement requirement.",
    );
  if (item.source !== undefined) {
    const source = item.source;
    if (
      !source ||
      !["scope", "deliverables", "brief"].includes(source.field) ||
      typeof source.quote !== "string" ||
      !source.quote.trim() ||
      source.quote.length > 1000 ||
      typeof source.name !== "string" ||
      source.name.length > 200 ||
      (source.page !== undefined &&
        (!Number.isInteger(source.page) || source.page < 1 || source.page > 50))
    )
      throw new Error("Keep a valid source passage with this requirement.");
  }
  return item;
}

export function validateBriefDraft(value) {
  if (
    !value ||
    typeof value.text !== "string" ||
    value.text.length > 6000 ||
    typeof value.sourceName !== "string" ||
    value.sourceName.length > 200 ||
    typeof value.reviewed !== "boolean" ||
    !Array.isArray(value.suggestions) ||
    value.suggestions.length > 40
  )
    throw new Error(
      "This brief review draft cannot be read. Keep its original text.",
    );
  const ids = new Set();
  for (const item of value.suggestions) {
    // In-progress corrections may intentionally have a blank room or label.
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[\w-]{1,100}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.label !== "string" ||
      item.label.length > 500 ||
      typeof item.area !== "string" ||
      item.area.length > 200 ||
      typeof item.selected !== "boolean" ||
      !TASK_KINDS.includes(item.kind) ||
      (item.reading !== undefined && !READINGS.includes(item.reading))
    )
      throw new Error("Invalid suggested work requirement.");
    validateTaskDetails({
      ...item,
      kind: item.kind === "measurement" ? "review" : item.kind,
    });
    ids.add(item.id);
  }
  return value;
}

function passages(text, field, name) {
  let page;
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\[Page (\d+)\]$/);
    if (marker) {
      page = Number(marker[1]);
      continue;
    }
    for (const quote of line
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((part) => part.trim())
      .filter(Boolean)) {
      if (quote.length > 1000)
        throw new Error(
          "Split long brief passages into shorter requests before organizing them.",
        );
      result.push({ field, quote, name, ...(page ? { page } : {}) });
    }
  }
  return result;
}

function fromPassage(source) {
  const text = source.quote
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/[.!?]$/, "");
  const make = (label, kind = "review", area = "", reading) => ({
    id: crypto.randomUUID(),
    label,
    kind,
    area,
    ...(reading ? { reading } : {}),
    source,
    selected: true,
  });
  // Never turn a prohibition or conditional request into positive capture work.
  if (
    /\b(?:not|no|exclude[ds]?|except|unless|if|optional|do not|don't|without)\b/i.test(
      text,
    )
  )
    return [make(`Review limitation: ${text}`)];
  const measurement = text.match(
    new RegExp(
      `^(?:measure|check|verify|record)\\s+(?:the\\s+)?(.+?)\\s+(${READINGS.join("|")})\\b(.*)$`,
      "i",
    ),
  );
  if (measurement) {
    const area = measurement[1].trim();
    const tail = `${measurement[2]}${measurement[3]}`;
    const labels = READINGS.filter((name) =>
      new RegExp(`\\b${name}\\b`, "i").test(tail),
    );
    return labels.map((reading) =>
      make(
        `Check ${area} ${reading.toLowerCase()} against the tape`,
        "measurement",
        area,
        reading,
      ),
    );
  }
  const capture = text.match(
    /^(?:capture|scan|photograph)\s+(?:the\s+)?(.+)$/i,
  );
  if (
    capture &&
    !/\b(?:then|including|with|using|as well|and)\b/i.test(capture[1])
  ) {
    const rooms = capture[1].split(/\s*[,+;]\s*/).filter(Boolean);
    return rooms.map((area) =>
      make(`${text.split(/\s/)[0]} ${area}`, "capture", area),
    );
  }
  if (/^(?:send|deliver|provide|upload)\b/i.test(text))
    return [make(text, "delivery")];
  return [make(text)];
}

export function suggestTasks({
  project,
  text = "",
  sourceName = "Pasted brief",
}) {
  if (text.length > 6000)
    throw new Error(
      "Use a brief up to 6,000 characters, or organize it in smaller sections.",
    );
  const sources = text.trim()
    ? passages(text, "brief", sourceName)
    : [
        ...passages(project.scope || "", "scope", "Project scope"),
        ...passages(
          project.deliverables || "",
          "deliverables",
          "Requested outputs",
        ),
      ];
  const suggestions = sources.flatMap(fromPassage);
  if (suggestions.length > 40)
    throw new Error(
      "Organize a smaller section of this brief. A checklist supports up to 40 requirements.",
    );
  if (!suggestions.length)
    throw new Error(
      "Add the requested work to the project, or paste a brief here first.",
    );
  validateBriefDraft({ text, sourceName, suggestions, reviewed: false });
  return suggestions;
}

export function appendReviewedTasks(requirements, draft) {
  validateBriefDraft(draft);
  if (!draft.reviewed)
    throw new Error(
      "Review the suggested tasks against the source before adding them.",
    );
  const selected = draft.suggestions.filter((item) => item.selected);
  if (!selected.length)
    throw new Error("Select at least one requirement to add.");
  const key = (item) =>
    [item.label, item.area, item.kind || "review", item.reading || ""]
      .map(normalized)
      .join("|");
  const keys = new Set(requirements.map(key));
  const additions = [];
  for (const item of selected) {
    if (!item.label.trim())
      throw new Error("Give each selected requirement a clear name.");
    validateTaskDetails(item);
    const previous = requirements.find((row) => key(row) === key(item));
    if (
      previous?.source &&
      normalized(previous.source.quote) !== normalized(item.source.quote)
    )
      throw new Error(
        "An existing task has changed source wording. Review that task or record a changed request before adding it; prior checks stay intact.",
      );
    if (!keys.has(key(item))) {
      const { selected: ignored, ...fields } = item;
      additions.push({
        ...fields,
        label: fields.label.trim(),
        area: fields.area.trim(),
        state: "todo",
        reason: "",
        evidence: [],
      });
      keys.add(key(item));
    }
  }
  if (requirements.length + additions.length > 40)
    throw new Error(
      "This would exceed 40 requirements. Nothing has been replaced.",
    );
  return [...requirements, ...additions];
}
