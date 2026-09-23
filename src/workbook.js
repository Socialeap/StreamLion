import { FIELD_KEYS, validateFields } from "./project-schema.js";
export const META = [
  "recordId",
  "revisionId",
  "parentRevisionId",
  "updatedAt",
  "reviewState",
];
export const PROJECT_HEADERS = [...META, ...FIELD_KEYS];
export const NOTE_HEADERS = [
  ...META,
  "projectId",
  "area",
  "text",
  "sourceText",
  "audioUrl",
];
export const TABS = { Projects: PROJECT_HEADERS, Observations: NOTE_HEADERS };
export const id = () => crypto.randomUUID();
export function columnName(n) {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function assertHeaders(rows, headers) {
  if (JSON.stringify(rows[0]) !== JSON.stringify(headers))
    throw new Error(
      "Workbook headers do not match StreamLion v1. Restore the template headers before syncing.",
    );
}
export function validateNote(value) {
  const result = {};
  for (const key of NOTE_HEADERS.slice(5)) {
    const v = value[key] ?? "";
    if (typeof v !== "string" || v.length > 12000)
      throw new Error(`Invalid annotation ${key}.`);
    result[key] = v;
  }
  if (
    !result.projectId ||
    !result.area.trim() ||
    (!result.text.trim() && !result.audioUrl)
  )
    throw new Error(
      "Annotation needs a project, area, and text or audio link.",
    );
  if (result.audioUrl && !result.audioUrl.startsWith("https://"))
    throw new Error("Audio link must use HTTPS.");
  return result;
}
export function validateRevision(record, headers) {
  for (const k of ["recordId", "revisionId"])
    if (typeof record[k] !== "string" || !/^[\w-]{1,100}$/.test(record[k]))
      throw new Error("Invalid record identity.");
  if (
    typeof record.parentRevisionId !== "string" ||
    (record.parentRevisionId && !/^[\w-]{1,100}$/.test(record.parentRevisionId))
  )
    throw new Error("Invalid parent identity.");
  if (
    !["draft", "reviewed"].includes(record.reviewState) ||
    typeof record.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(record.updatedAt))
  )
    throw new Error("Invalid revision metadata.");
  if (headers === PROJECT_HEADERS)
    validateFields(
      Object.fromEntries(FIELD_KEYS.map((k) => [k, record[k] ?? ""])),
    );
  else validateNote(record);
  return record;
}
// Append-only revisions. A fork is surfaced, never resolved by last-row-wins.
export function readRecords(rows, headers) {
  assertHeaders(rows, headers);
  const byRevision = new Map(),
    byRecord = new Map();
  for (const values of rows.slice(1)) {
    if (!values.some((v) => v !== "" && v != null)) continue;
    if (values.length > headers.length)
      throw new Error("Unexpected workbook columns.");
    const r = Object.fromEntries(
      headers.map((k, i) => [k, String(values[i] ?? "")]),
    );
    validateRevision(r, headers);
    for (const k of ["recordId", "revisionId", "updatedAt"])
      if (!r[k]) throw new Error(`Missing ${k} in workbook.`);
    if (
      !/^[\w-]{1,100}$/.test(r.recordId) ||
      !/^[\w-]{1,100}$/.test(r.revisionId)
    )
      throw new Error("Invalid record identity.");
    if (!["draft", "reviewed"].includes(r.reviewState))
      throw new Error("Invalid review state.");
    if (headers === PROJECT_HEADERS)
      Object.assign(
        r,
        validateFields(Object.fromEntries(FIELD_KEYS.map((k) => [k, r[k]]))),
      );
    else Object.assign(r, validateNote(r));
    if (byRevision.has(r.revisionId)) {
      if (JSON.stringify(byRevision.get(r.revisionId)) !== JSON.stringify(r))
        throw new Error("Conflicting duplicate revision.");
      continue;
    }
    byRevision.set(r.revisionId, r);
    const records = byRecord.get(r.recordId) || [];
    records.push(r);
    byRecord.set(r.recordId, records);
  }
  return [...byRecord.values()].map((revisions) => {
    const parents = new Set();
    for (const r of revisions) {
      if (parents.has(r.parentRevisionId))
        throw new Error(
          `Concurrent edits for ${r.recordId}; review the workbook history before continuing.`,
        );
      parents.add(r.parentRevisionId);
      if (
        r.parentRevisionId &&
        byRevision.get(r.parentRevisionId)?.recordId !== r.recordId
      )
        throw new Error("Broken revision history.");
    }
    const heads = revisions.filter((r) => !parents.has(r.revisionId));
    if (heads.length !== 1 || !parents.has(""))
      throw new Error("Incomplete or cyclic revision history.");
    let cursor = heads[0],
      seen = new Set();
    while (cursor) {
      if (seen.has(cursor.revisionId)) throw new Error("Cyclic history.");
      seen.add(cursor.revisionId);
      cursor = cursor.parentRevisionId
        ? byRevision.get(cursor.parentRevisionId)
        : null;
    }
    if (seen.size !== revisions.length)
      throw new Error("Disconnected revision history.");
    return heads[0];
  });
}
export function makeRevision(
  fields,
  previous,
  recordId = id(),
  reviewState = "draft",
) {
  return {
    ...fields,
    recordId: previous?.recordId || recordId,
    revisionId: id(),
    parentRevisionId: previous?.revisionId || "",
    updatedAt: new Date().toISOString(),
    reviewState,
  };
}
export function rowFor(record, headers) {
  return headers.map((k) => record[k] ?? "");
}
export function assertUnchanged(remote, expected) {
  if (JSON.stringify(remote ?? null) !== JSON.stringify(expected ?? null))
    throw new Error(
      "This record changed in Google. Refresh and review before saving. Your local draft is preserved.",
    );
}
export function toLocalProject(r) {
  return {
    ...r,
    id: r.recordId,
    status: r.reviewState === "reviewed" ? "Reviewed" : "Draft",
    offeredCents: r.offeredFee ? Math.round(+r.offeredFee * 100) : null,
  };
}
export function toLocalNote(r) {
  return {
    ...r,
    id: r.recordId,
    jobId: r.projectId,
    createdAt: r.updatedAt,
    reviewed: r.reviewState === "reviewed",
    revisions: [],
  };
}
