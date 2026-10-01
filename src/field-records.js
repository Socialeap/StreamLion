import { validateNote } from "./workbook.js";
import { WORKFLOW_AREA } from "./workflow.js";

export function newFieldRecord(context, bookId = "", blob) {
  if (
    !context.jobId ||
    !context.area?.trim() ||
    context.area.trim() === WORKFLOW_AREA
  )
    throw new Error("Choose a project and a site area for this field record.");
  if (
    blob &&
    (!blob.size ||
      blob.size > 5 * 1024 * 1024 ||
      !/^(audio|image)\//.test(blob.type))
  )
    throw new Error(
      "Choose a photo or voice memo up to 5 MB. Short voice memos work best.",
    );
  const id = crypto.randomUUID();
  const text =
    context.text ||
    (blob?.type.startsWith("image/")
      ? `Photo: ${context.fileName || context.area.trim()}`
      : "");
  if (!text && !blob) throw new Error("Add a note or field file.");
  if (text.length > 10000)
    throw new Error("This note is too long. Split it into two records.");
  return {
    ...context,
    area: context.area.trim(),
    text,
    sourceText: text,
    id,
    createdAt: new Date().toISOString(),
    reviewed: context.reviewed === true,
    revisions: [],
    ...(bookId ? { pendingBookId: bookId } : {}),
    ...(blob
      ? {
          audioId: id,
          mediaType: blob.type,
          fileName:
            context.fileName ||
            `StreamLion-${id}.${blob.type.startsWith("image/") ? "jpg" : blob.type.includes("mp4") ? "m4a" : "webm"}`,
        }
      : {}),
  };
}

// Persist identities before writes; acknowledge only after Sheets verification.
export async function sendFieldRecord(
  record,
  { getBlob, reserveId, retainFile, persist, save, acknowledge },
) {
  let note = { ...record };
  if (!note.pendingBookId)
    throw new Error("This field record has no Google destination.");
  if (note.audioId && !note.audioUrl) {
    const blob = await getBlob(note.audioId);
    if (!blob)
      throw new Error(
        "The original field file is unavailable on this device. Download a backup before proceeding.",
      );
    if (!note.driveFileId) {
      note.driveFileId = await reserveId();
      await persist(note);
    }
    note.audioUrl = await retainFile({
      fileId: note.driveFileId,
      noteId: note.id,
      bookId: note.pendingBookId,
      name: note.fileName,
      blob,
    });
    await persist(note);
  }
  const fields = validateNote({
    projectId: note.jobId,
    area: note.area,
    text: note.text,
    sourceText: note.sourceText || note.text,
    audioUrl: note.audioUrl || "",
  });
  await save(fields, note.id, note.reviewed ? "reviewed" : "draft");
  await acknowledge(note.id);
}
