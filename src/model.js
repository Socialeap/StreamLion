export const emptyWorkspace = () => ({ version: 1, jobs: [], notes: [] });
export function feeCents(raw) {
  if (raw === "") return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw))
    throw new Error(
      "Enter a positive USD amount with at most two decimal places.",
    );
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function reviseNote(note, text, at) {
  if (!text.trim()) throw new Error("A note cannot be empty.");
  return {
    ...note,
    text,
    revisions: [
      ...(note.revisions || []),
      { text: note.text, at: note.updatedAt || note.createdAt },
    ],
    updatedAt: at,
    reviewed: false,
  };
}
export function assertWorkspace(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.jobs) ||
    !Array.isArray(value.notes)
  )
    throw new Error(
      "Unrecognized workspace. Existing data has not been overwritten.",
    );
  return value;
}
export function exportWorkspace(workspace) {
  return JSON.stringify(
    {
      ...workspace,
      exportedAt: new Date().toISOString(),
      audioNotice: "Audio is downloaded separately from each note.",
    },
    null,
    2,
  );
}
