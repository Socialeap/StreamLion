import { stableJSON, DAY } from "./client-workflow.js";

const prefix = "streamlion-coordination-draft-v1:";
export const coordinationDraftKey = (role, scope, jobId) =>
  prefix + JSON.stringify([role, scope, jobId]);
export function readCoordinationDraft(key, job, keys, storage) {
  try {
    if (job.closedAt) return null;
    const saved = JSON.parse(storage.getItem(key) || "null");
    const validFields = (fields) =>
      fields &&
      typeof fields === "object" &&
      !Array.isArray(fields) &&
      Object.entries(fields).every(
        ([k, v]) =>
          keys.includes(k) && typeof v === "string" && v.length <= 6000,
      );
    if (
      !saved ||
      saved.version !== 1 ||
      saved.jobId !== job.id ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 0 ||
      !Number.isFinite(saved.savedAt) ||
      saved.savedAt > Date.now() ||
      Date.now() - saved.savedAt > 7 * DAY ||
      !validFields(saved.fields) ||
      !validFields(saved.baseFields)
    )
      return null;
    if (stableJSON(saved.fields) === stableJSON(saved.baseFields)) return null;
    return {
      fields: { ...job.fields, ...saved.fields },
      baseFields: { ...job.fields, ...saved.baseFields },
      revision: saved.revision,
    };
  } catch {
    return null;
  }
}
export function writeCoordinationDraft(
  key,
  job,
  keys,
  fields,
  baseFields,
  revision,
  storage,
) {
  const changedKeys = keys.filter(
    (k) => (fields[k] || "") !== (baseFields[k] || ""),
  );
  const pick = (value) =>
    Object.fromEntries(changedKeys.map((k) => [k, value[k] || ""]));
  storage.setItem(
    key,
    JSON.stringify({
      version: 1,
      jobId: job.id,
      fields: pick(fields),
      baseFields: pick(baseFields),
      revision,
      savedAt: Date.now(),
    }),
  );
}
export function clearCoordinationDraft(key, storage) {
  storage.removeItem(key);
}
export function clearCoordinationDrafts(role, scope, storage) {
  const matches = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const owner = JSON.parse(key.slice(prefix.length));
      if (owner[0] === role && owner[1] === scope) matches.push(key);
    } catch {
      /* Unknown storage is preserved. */
    }
  }
  for (const key of matches) storage.removeItem(key);
}
