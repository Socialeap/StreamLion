import { CHECKLIST_MAX_TASKS } from "./checklist-limits.js";
// Local, conservative suggestions. Source wording always travels with the task;
// a provider reviews the suggestions before they become the working checklist.
export const TASK_KINDS = ["capture", "measurement", "delivery", "review"];
import { MEASUREMENT_LABELS } from "./measurements.js";
export const READINGS = MEASUREMENT_LABELS;
const normalized = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const PROJECT_BRIEF_LIMITS = Object.freeze({
  text: 6000,
  suggestions: CHECKLIST_MAX_TASKS,
  passage: 1000,
});

export function validateTaskDetails(item, limits = PROJECT_BRIEF_LIMITS) {
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
      source.quote.length > limits.passage ||
      typeof source.name !== "string" ||
      source.name.length > 200 ||
      (source.page !== undefined &&
        (!Number.isInteger(source.page) || source.page < 1 || source.page > 50))
    )
      throw new Error("Keep a valid source passage with this requirement.");
  }
  return item;
}

export function validateBriefDraft(value, limits = PROJECT_BRIEF_LIMITS) {
  if (
    !value ||
    typeof value.text !== "string" ||
    value.text.length > limits.text ||
    typeof value.sourceName !== "string" ||
    value.sourceName.length > 200 ||
    typeof value.reviewed !== "boolean" ||
    !Array.isArray(value.suggestions) ||
    value.suggestions.length > limits.suggestions
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
    validateTaskDetails(
      {
        ...item,
        kind: item.kind === "measurement" ? "review" : item.kind,
      },
      limits,
    );
    ids.add(item.id);
  }
  return value;
}

function passages(text, field, name, limits) {
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
      if (quote.length > limits.passage)
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
    label: label.length > 500 ? `${label.slice(0, 499)}…` : label,
    kind,
    area,
    ...(reading ? { reading } : {}),
    source,
    selected: true,
  });
  const limitation =
    /\b(?:not|no|never|exclud(?:e[ds]?|ing)|except|unless|if|when|only|optional|don['’]t|isn['’]t|aren['’]t|can['’]t|without|skip|omit|avoid|out of scope|pending|subject to|provided that)\b/i;
  const action =
    "(?:capture|scan|photograph|take photos? of|measure|check|verify|record|send|deliver|provide|upload)";
  const clean = (part) =>
    part
      .trim()
      .replace(/^(?:hi|hello|hey)(?:\s+team)?[,!]\s*/i, "")
      .replace(/^(?:(?:could|can|would) you\s+)?please\s+/i, "")
      .replace(/^(?:could|can|would) you\s+/i, "")
      .replace(
        /^(?:(?:our|the) client needs|we need|we require)\s+(?:a\s+)?/i,
        "",
      )
      .replace(/^3d walkthrough of\s+/i, "Scan ")
      .replace(/^photos? of\s+/i, "Take photos of ");
  // A condition may qualify several actions. Keep the whole passage unresolved
  // rather than splitting it into unconditional positive work.
  if (limitation.test(text)) return [make(`Review limitation: ${text}`)];
  // A leading location can qualify the following action. Do not detach it and
  // invent a generic space such as "room" for a measurement.
  if (
    new RegExp(
      `^(?:for|in|at|on|within|inside)\\b.+,\\s*(?:please\\s+)?${action}\\b`,
      "i",
    ).test(text)
  )
    return [make(text)];
  const parts = text
    .split(
      new RegExp(
        `;\\s*|,?\\s+plus\\s+(?=photos? of\\b)|,?\\s+(?:and|then)\\s+(?=(?:please\\s+)?${action}\\b)|,\\s*(?=(?:please\\s+)?${action}\\b)`,
        "i",
      ),
    )
    .filter((part) => part.trim());
  return parts.flatMap((part) => {
    const request = clean(part);
    if (!request) return [];
    const measurement = request.match(
      /^(?:measure|check|verify|record)\s+(?:the\s+)?(.+)$/i,
    );
    if (measurement) {
      const dimension = `(?:ceiling height|${READINGS.join("|")})`;
      const dimensionList = `${dimension}(?:\\s*(?:,|and|&|\\+)\\s*(?:the\\s+)?${dimension})*`;
      const dimensionFirst = measurement[1].match(
        new RegExp(
          `^(${dimensionList})\\s+(?:of|in|for)\\s+(?:the\\s+)?(.+)$`,
          "i",
        ),
      );
      const areaFirst = measurement[1].match(
        new RegExp(`^(.+?)\\s+(${dimensionList})$`, "i"),
      );
      const area = (dimensionFirst?.[2] || areaFirst?.[1] || "").trim();
      const dimensions = dimensionFirst?.[1] || areaFirst?.[2];
      if (
        area &&
        area.length <= 200 &&
        dimensions &&
        !new RegExp(`\\b(?:${READINGS.join("|")}|and|or)\\b|[,+&]`, "i").test(
          area,
        ) &&
        !new RegExp(`\\b${action}\\b`, "i").test(area)
      ) {
        const names = dimensions.replace(/ceiling height/gi, "Height");
        return READINGS.filter((reading) =>
          new RegExp(`\\b${reading}\\b`, "i").test(names),
        ).map((reading) =>
          make(
            `Check ${area} ${reading.toLowerCase()} against the tape`,
            "measurement",
            area,
            reading,
          ),
        );
      }
      return [make(`Confirm measurement: ${request}`)];
    }
    const capture = request.match(
      /^(capture|scan|photograph|take photos? of)\s+(?:the\s+)?(.+)$/i,
    );
    if (
      capture &&
      !/\b(?:then|including|with|using|as well|plus|but|before|after|or|by|at|on)\b/i.test(
        capture[2],
      )
    ) {
      const rooms = capture[2]
        .split(/\s*(?:,|\+|\band\b|&)\s*/i)
        .map((room) => room.trim().replace(/^the\s+/i, ""))
        .filter(Boolean);
      if (
        rooms.length &&
        rooms.every(
          (room) =>
            room.length <= 200 &&
            !new RegExp(`\\b${action}\\b`, "i").test(room),
        )
      )
        return rooms.map((area) =>
          make(
            `${capture[1][0].toUpperCase()}${capture[1].slice(1)} ${area}`,
            "capture",
            area,
          ),
        );
    }
    if (/^(?:send|deliver|provide|upload)\b/i.test(request))
      return [make(request, "delivery")];
    return [make(request)];
  });
}

export function suggestTasks(
  { project, text = "", sourceName = "Pasted brief" },
  limits = PROJECT_BRIEF_LIMITS,
) {
  if (text.length > limits.text)
    throw new Error(
      `Use a brief up to ${limits.text.toLocaleString("en-US")} characters, or organize it in smaller sections.`,
    );
  const sources = text.trim()
    ? passages(text, "brief", sourceName, limits)
    : [
        ...passages(project.scope || "", "scope", "Project scope", limits),
        ...passages(
          project.deliverables || "",
          "deliverables",
          "Requested outputs",
          limits,
        ),
      ];
  const suggestions = sources.flatMap(fromPassage);
  if (suggestions.length > limits.suggestions)
    throw new Error(
      `Organize a smaller section of this brief. A checklist supports up to ${limits.suggestions} requirements.`,
    );
  if (!suggestions.length)
    throw new Error(
      "Add the requested work to the project, or paste a brief here first.",
    );
  validateBriefDraft(
    { text, sourceName, suggestions, reviewed: false },
    limits,
  );
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
  if (requirements.length + additions.length > PROJECT_BRIEF_LIMITS.suggestions)
    throw new Error(
      `This would exceed ${CHECKLIST_MAX_TASKS} requirements. Nothing has been replaced.`,
    );
  return [...requirements, ...additions];
}
