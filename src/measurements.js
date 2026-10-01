// Exact, bounded text parsing. Speech-to-text is supplied by the device keyboard.
// Never infer a missing unit, room boundary, direction, or geometric area.
export const MEASUREMENT_KIND = "streamlion.measurements";
const labels = {
  l: "Length",
  length: "Length",
  w: "Width",
  width: "Width",
  h: "Height",
  height: "Height",
  c: "Ceiling",
  ceiling: "Ceiling",
  d: "Depth",
  depth: "Depth",
  segment: "Segment",
  diagonal: "Diagonal",
};
const words = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const numerals = Object.keys(words).join("|");
const fractions = {
  "½": "1/2",
  "¼": "1/4",
  "¾": "3/4",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
  "⅓": "1/3",
  "⅔": "2/3",
};
function integerWords(value) {
  if (/^\d+$/.test(value)) return Number(value);
  let total = 0,
    part = 0,
    previous = null;
  for (const word of value.trim().split(/\s+/)) {
    if (word === "and") continue;
    if (word in words) {
      const n = words[word];
      // Adjacent small numbers ("one two") or tens ("twenty thirty")
      // are ambiguous dictation, not numbers to add together.
      if (previous !== null && !(previous >= 20 && n > 0 && n < 10)) return NaN;
      part += n;
      previous = n;
    } else if (word === "hundred") {
      if (previous === null || previous < 1 || previous > 9 || part > 9)
        return NaN;
      part *= 100;
      previous = null;
    } else if (word === "thousand") {
      if (!part || total) return NaN;
      total += part * 1000;
      part = 0;
      previous = null;
    } else return NaN;
  }
  return total + part;
}
export function normalizeReading(raw) {
  let value = raw
    .toLowerCase()
    .replace(/[′’]/g, " feet ")
    .replace(/[″”]/g, " inches ")
    .replace(/'/g, " feet ")
    .replace(/"/g, " inches ");
  value = value
    .replace(/[½¼¾⅛⅜⅝⅞⅓⅔]/g, (f) => ` ${fractions[f]} `)
    .replace(/-/g, " ");
  const numerator = `(?:\\d+|(?:${numerals})(?:\\s+(?:${numerals}))?)`;
  const denominators = {
    half: 2,
    halves: 2,
    quarter: 4,
    quarters: 4,
    fourth: 4,
    fourths: 4,
    eighth: 8,
    eighths: 8,
    sixteenth: 16,
    sixteenths: 16,
    "thirty second": 32,
    "thirty seconds": 32,
    "sixty fourth": 64,
    "sixty fourths": 64,
  };
  value = value.replace(
    new RegExp(
      `(${numerator})\\s+(${Object.keys(denominators)
        .sort((a, b) => b.length - a.length)
        .join("|")})\\b`,
      "g",
    ),
    (_, n, d) => `${integerWords(n)}/${denominators[d]}`,
  );
  value = value.replace(
    /\b(?:a|an)\s+(half|quarter)\b/g,
    (_, d) => `1/${denominators[d]}`,
  );
  value = value.replace(
    new RegExp(
      `\\b(\\d+|(?:${numerals})(?:\\s+(?:${numerals}))?)\\s+point\\s+((?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\\s+(?:zero|one|two|three|four|five|six|seven|eight|nine))*)\\b`,
      "g",
    ),
    (_, whole, decimal) =>
      `${integerWords(whole)}.${decimal
        .split(/\s+/)
        .map((d) => words[d])
        .join("")}`,
  );
  value = value.replace(
    new RegExp(
      `\\b(?:${numerals}|hundred|thousand)(?:\\s+(?:${numerals}|hundred|thousand|and))*\\b`,
      "g",
    ),
    (n) => String(integerWords(n)),
  );
  // Common dictation spelling for decimals; keep decimal digits exact.
  value = value.replace(
    /\b(\d+)\s+point\s+(\d(?:\s+\d)*)\b/g,
    (_, whole, decimal) => `${whole}.${decimal.replace(/\s/g, "")}`,
  );
  return value
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
function rational(n, d = 1) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n < 0 || d <= 0)
    throw new Error("Use a positive reading with explicit units.");
  const factor = gcd(n, d);
  return { n: n / factor, d: d / factor };
}
function add(a, b) {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}
function number(value) {
  const match =
    /^(?:(\d+)(?:\.(\d{1,6}))?(?:\s+)?(?:(\d+)\/(\d+))?|(?:(\d+)\/(\d+)))$/.exec(
      value.trim(),
    );
  if (!match)
    throw new Error(
      "Check the number or fraction. Keep units with each reading.",
    );
  let result = match[1]
    ? rational(
        Number(match[1] + (match[2] || "")),
        10 ** (match[2]?.length || 0),
      )
    : rational(0);
  const n = Number(match[3] || match[5] || 0),
    d = Number(match[4] || match[6] || 1);
  if (n && (n >= d || d > 128))
    throw new Error("Check this fraction; use a fraction smaller than one.");
  result = add(result, rational(n, d));
  if (result.n > 1e9) throw new Error("Check this unusually large reading.");
  return result;
}
function mixed({ n, d }) {
  const whole = Math.floor(n / d),
    rest = n % d;
  return `${whole || (!rest ? "0" : "")}${rest ? `${whole ? " " : ""}${rest}/${d}` : ""}`;
}
export function formatValue(value, unit) {
  return `${mixed(value)} ${unit}`;
}
function parseValue(raw) {
  if (/-\s*\d|\b(?:minus|negative)\b/i.test(raw))
    throw new Error("Check this negative reading; nothing was changed.");
  let value = normalizeReading(raw);
  // "four inches three eighths" is an accepted fraction-after-unit form.
  value = value.replace(/(\d+)\s+(inches|inch|in)\s+(\d+\/\d+)$/i, "$1 $3 $2");
  const feet =
    /^(.*?)\s*(?:feet|foot|ft)(?:\s+(.*?)\s*(?:inches|inch|in))?$/.exec(value);
  if (feet) {
    const f = number(feet[1]),
      inch = feet[2] ? number(feet[2]) : rational(0);
    if (inch.n >= 12 * inch.d)
      throw new Error(
        "The inches after feet must be less than twelve. Check the reading.",
      );
    const amount = add(rational(f.n * 12, f.d), inch);
    if (!amount.n) throw new Error("Check the zero reading.");
    return { amount, baseUnit: "in", display: `${mixed(f)}′ ${mixed(inch)}″` };
  }
  const single =
    /^(.*?)\s*(inches|inch|in|millimeters|millimetres|millimeter|millimetre|mm|centimeters|centimetres|centimeter|centimetre|cm|meters|metres|meter|metre|m)$/.exec(
      value,
    );
  if (!single)
    throw new Error(
      "Add explicit units: feet/inches, mm, cm, or m. Nothing was guessed.",
    );
  const quantity = number(single[1]);
  if (!quantity.n) throw new Error("Check the zero reading.");
  const unit = /^(in|inch)/.test(single[2])
    ? "in"
    : /^(mm|milli)/.test(single[2])
      ? "mm"
      : /^(cm|centi)/.test(single[2])
        ? "cm"
        : "m";
  const amount = rational(
    quantity.n * (unit === "m" ? 1000 : unit === "cm" ? 10 : 1),
    quantity.d,
  );
  return {
    amount,
    baseUnit: unit === "in" ? "in" : "mm",
    display: single[1].includes("/")
      ? formatValue(quantity, unit)
      : `${single[1].trim()} ${unit}`,
  };
}
export function parseMeasurements(raw, previous = []) {
  if (raw.length > 3000)
    throw new Error(
      "Split this dictation into shorter batches (up to 3,000 characters).",
    );
  const pattern =
    /\b(continuing(?:\s+(?:length|width|height|ceiling|depth|segment|diagonal))?|length|width|height|ceiling|depth|segment|diagonal|L|W|H|C|D)\s*:?\s+(?=\d|[a-z½¼¾⅛⅜⅝⅞⅓⅔])/gi;
  const matches = [...raw.matchAll(pattern)];
  const entries = [],
    issues = [];
  if (!matches.length)
    return {
      entries,
      issues: [
        {
          raw,
          message:
            "Start each reading with Length, Width, Ceiling, Height, Depth, Diagonal, or Segment.",
        },
      ],
    };
  const prefix = raw.slice(0, matches[0].index).replace(/[\s,;.]/g, "");
  if (prefix)
    issues.push({
      raw: raw.slice(0, matches[0].index),
      message: "Choose the room above. This extra wording needs review.",
    });
  if (matches.length > 24)
    throw new Error(
      "Save up to 24 measurements at a time, then continue in the same room.",
    );
  matches.forEach((match, i) => {
    const source = raw
      .slice(match.index, matches[i + 1]?.index ?? raw.length)
      .trim()
      .replace(/[;,.]+$/, "");
    const body = source
      .slice(match[0].trim().length)
      .trim()
      .replace(/^:\s*/, "");
    const continuing = /^continuing/i.test(match[1]);
    const last = entries.at(-1) || previous.at(-1);
    const name = match[1].toLowerCase().replace(/^continuing\s*/, "");
    const label = labels[name] || (continuing ? last?.label : null);
    try {
      if (!label)
        throw new Error(
          "Continuing needs a previous measurement in this room.",
        );
      if (
        continuing &&
        ((i > 0 && issues.length) || !last || last.label !== label)
      )
        throw new Error("Check which previous segment this continues from.");
      const description =
        /\s+(?=(?:to|from|between|along|under|above|at|beside|then)\b)|\s*\(/i.exec(
          body,
        );
      const reading = description
        ? body.slice(0, description.index).trim()
        : body;
      const detail = description
        ? body
            .slice(description.index)
            .trim()
            .replace(/^\(|\)$/g, "")
        : "";
      if (
        /\b(?:feet|foot|ft|inches|inch|mm|cm|meters|metres)\b|[′″]/i.test(
          detail,
        ) ||
        /\b\d+(?:\.\d+)?(?:\s+\d+\/\d+)?\s+(?:in|m|feet|inches)\b/i.test(
          normalizeReading(detail),
        )
      )
        throw new Error(
          "Another dimension may be in this description. Give each reading its own name and units.",
        );
      const parsed = parseValue(reading);
      if (continuing && last.baseUnit !== parsed.baseUnit)
        throw new Error("Use the same unit system for connected segments.");
      entries.push({
        id: crypto.randomUUID(),
        label,
        raw: source,
        detail,
        ...parsed,
        ...(continuing ? { continues: last.id } : {}),
      });
    } catch (e) {
      issues.push({ raw: source, message: e.message });
    }
  });
  return { entries, issues };
}
export function connectedTotals(entries) {
  const chains = new Map();
  for (const entry of entries) {
    const previous = entry.continues && chains.get(entry.continues);
    const chain = previous || {
      count: 0,
      amount: rational(0),
      unit: entry.baseUnit,
    };
    chain.count++;
    chain.amount = add(chain.amount, entry.amount);
    chains.set(entry.id, chain);
  }
  return [...new Set(chains.values())]
    .filter((c) => c.count > 1)
    .map(
      (c) =>
        `${c.count} connected segments: ${formatValue(c.amount, c.unit)} measured run (not floor area)`,
    );
}
export function measurementSet(value) {
  if (
    !value ||
    value.kind !== MEASUREMENT_KIND ||
    value.version !== 1 ||
    typeof value.room !== "string" ||
    !value.room.trim() ||
    value.room.length > 100 ||
    typeof value.floor !== "string" ||
    value.floor.length > 100 ||
    !["Interior", "Exterior"].includes(value.side) ||
    typeof value.enteredAt !== "string" ||
    !Number.isFinite(Date.parse(value.enteredAt)) ||
    typeof value.raw !== "string" ||
    value.raw.length > 3000 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 24 ||
    !Array.isArray(value.issues)
  )
    throw new Error(
      "Unsupported measurement record. Keep its original before editing.",
    );
  const ids = new Set();
  for (const entry of value.entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      ids.has(entry.id) ||
      !Object.values(labels).includes(entry.label) ||
      !["in", "mm"].includes(entry.baseUnit) ||
      typeof entry.raw !== "string" ||
      typeof entry.display !== "string" ||
      typeof entry.detail !== "string"
    )
      throw new Error(
        "Invalid measurement entry. Keep its original before editing.",
      );
    const amount = rational(entry.amount?.n, entry.amount?.d);
    const parsed = parseMeasurements(
      entry.raw,
      value.entries.slice(0, value.entries.indexOf(entry)),
    );
    const actual = parsed.entries[0];
    if (
      !amount.n ||
      parsed.issues.length ||
      parsed.entries.length !== 1 ||
      actual.label !== entry.label ||
      actual.baseUnit !== entry.baseUnit ||
      actual.amount.n !== amount.n ||
      actual.amount.d !== amount.d ||
      actual.display !== entry.display ||
      actual.detail !== entry.detail ||
      !!actual.continues !== !!entry.continues ||
      (entry.continues &&
        (!ids.has(entry.continues) || entry.continues !== actual.continues))
    )
      throw new Error(
        "Measurement values do not match their original reading. Review before saving.",
      );
    ids.add(entry.id);
  }
  if (
    value.issues.some(
      (i) => !i || typeof i.raw !== "string" || typeof i.message !== "string",
    )
  )
    throw new Error("Invalid unresolved measurement.");
  if (JSON.stringify(value).length > 10000)
    throw new Error(
      "This room batch is too long. Save smaller batches; nothing was truncated.",
    );
  return value;
}
export function isMeasurementRecord(note) {
  return (
    !!note.area?.startsWith("Measurements · ") ||
    (!!note.text?.trimStart().startsWith("{") &&
      note.text.includes(MEASUREMENT_KIND))
  );
}
export function readMeasurement(note) {
  if (!isMeasurementRecord(note)) return null;
  let value;
  try {
    value = JSON.parse(note.text);
  } catch {
    throw new Error(
      "Unreadable measurement record. Keep its original before editing.",
    );
  }
  return measurementSet(value);
}
export function measurementText(note) {
  let data;
  try {
    data = readMeasurement(note);
  } catch {
    // External workbook edits must not break Ask or hide the original evidence.
    return `MEASUREMENTS NEED REVIEW: This record could not be organized.\nOriginal stored wording: ${note.text}`;
  }
  if (!data) return note.text;
  return [
    `${data.side} · ${[data.floor, data.room].filter(Boolean).join(" / ")} · ${data.enteredAt.slice(0, 10)}`,
    ...data.entries.map(
      (e) =>
        `${e.label}: ${e.display}${e.detail ? ` (${e.detail})` : ""}${e.continues ? " — continues previous segment" : ""}`,
    ),
    ...connectedTotals(data.entries),
    ...data.issues.map((i) => `NEEDS REVIEW: ${i.raw} — ${i.message}`),
    `Original dictation: ${data.raw}`,
  ].join("\n");
}

export function measurementNeedsReview(note) {
  try {
    return !!readMeasurement(note)?.issues.length;
  } catch {
    return true;
  }
}
