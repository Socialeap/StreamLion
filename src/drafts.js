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
// A delayed acknowledgment must not erase text entered after the failed save.
export function clearSavedDraft(scope, operation) {
  const { tab, revision, expected } = operation;
  if (tab === "Projects") {
    const key = `${scope}:project:${expected ? revision.recordId : "new"}`;
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
