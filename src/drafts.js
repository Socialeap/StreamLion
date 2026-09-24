const prefix = "streamlion-draft-v1:";
export function readDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(prefix + key) || "null");
  } catch {
    return null;
  }
}
export function writeDraft(key, value) {
  localStorage.setItem(prefix + key, JSON.stringify(value));
}
export function clearDraft(key) {
  localStorage.removeItem(prefix + key);
}
export function projectDraftKey(scope, draftId = "new") {
  return `${scope}:project:${draftId}`;
}
export function listProjectDrafts(scope, { deleted = false } = {}) {
  try {
    const start = prefix + `${scope}:project:`;
    const drafts = [];
    for (let index = 0; index < localStorage.length; index++) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(start)) continue;
      const draftId = storageKey.slice(start.length);
      if (draftId !== "new" && !draftId.startsWith("draft-")) continue;
      const saved = readDraft(projectDraftKey(scope, draftId));
      const fields = saved?.fields;
      if (!fields || typeof fields.title !== "string" || !fields.title.trim())
        continue;
      if (Boolean(saved.deletedAt) !== deleted) continue;
      drafts.push({ draftId, scope, fields });
    }
    return drafts;
  } catch {
    return [];
  }
}
// A delayed acknowledgment must not erase text entered after the failed save.
export function clearSavedDraft(scope, operation) {
  const { tab, revision, expected } = operation;
  if (tab === "Projects") {
    const key =
      operation.draftKey ||
      projectDraftKey(scope, expected ? revision.recordId : "new");
    const draft = readDraft(key);
    if (
      draft?.fields &&
      Object.entries(draft.fields).every(([k, v]) => v === revision[k])
    )
      clearDraft(key);
  } else if (!expected) {
    const key = `${scope}:note:${revision.projectId}`;
    const draft = readDraft(key);
    if (draft?.area?.trim() === revision.area && draft?.text === revision.text)
      clearDraft(key);
  }
}
