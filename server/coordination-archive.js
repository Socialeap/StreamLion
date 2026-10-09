import {
  CoordinationError,
  stableJSON,
  reduceClientJob,
  clientView,
} from "../src/client-workflow.js";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  rowFor,
  readRecordHistory,
} from "../src/workbook.js";
import { clientWorkOrder } from "../src/client-work-order.js";
import { FIELD_KEYS } from "../src/project-schema.js";

export const ARCHIVE_KIND = "streamlion.client.archive";
export const ARCHIVE_MAX_BYTES = 700000;
export const ARCHIVE_MAX_FILES = 40;
export const ARCHIVE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ARCHIVE_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const archiveID = (id) =>
  typeof id === "string" && /^[\w-]{1,100}$/.test(id);
const plain = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const fail = (message = "Archive history needs reviewed recovery.") => {
  throw new CoordinationError(message + " Original records are retained.", 409);
};
export async function sha256Hex(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function archiveFileID(value) {
  if (archiveID(value)) return value;
  if (typeof value === "string") {
    const match =
      /^https:\/\/drive\.google\.com\/file\/d\/([\w-]{1,100})\/view(?:\?[^#]*)?$/.exec(
        value.trim(),
      );
    if (match) return match[1];
  }
  throw new CoordinationError(
    "Paste a Google Drive archive file ID or its file link.",
  );
}

// Only app-owned Drive originals are fetched. Other HTTPS links remain explicit
// references in the package; recovery never fetches an arbitrary remote URL.
export function archiveReferences(job, notes) {
  const files = new Map(),
    external = [];
  const add = (id, reference) => {
    if (!archiveID(id)) fail("Invalid original file identity.");
    const refs = files.get(id) || [];
    if (!refs.some((r) => stableJSON(r) === stableJSON(reference)))
      refs.push(reference);
    files.set(id, refs);
  };
  for (const a of job.attachments)
    add(a.driveId, { kind: "attachment", id: a.id });
  for (const note of notes) {
    if (!note.audioUrl) continue;
    const match =
      /^https:\/\/drive\.google\.com\/file\/d\/([\w-]{1,100})\/view$/.exec(
        note.audioUrl,
      );
    if (match) add(match[1], { kind: "field", id: note.recordId });
    else if (
      !external.some(
        (r) => r.url === note.audioUrl && r.recordId === note.recordId,
      )
    )
      external.push({ recordId: note.recordId, url: note.audioUrl });
  }
  if (files.size > ARCHIVE_MAX_FILES)
    fail("Archive exceeds the original file verification limit.");
  return { files, external };
}

export function archiveReports(job, notes, brand) {
  return {
    provider:
      "# " +
      job.fields.title +
      "\n\n" +
      Object.entries(job.accepted || job.fields)
        .filter(([, v]) => v)
        .map(([k, v]) => k + ": " + v)
        .join("\n\n") +
      "\n\n## Field observations\n\n" +
      notes
        .map(
          (n) =>
            n.area +
            ": " +
            n.text +
            (n.audioUrl ? "\nOriginal file reference: " + n.audioUrl : ""),
        )
        .join("\n\n"),
    client: clientWorkOrder(clientView(job), {
      brand,
      generatedAt: new Date(job.updatedAt).toISOString(),
    }),
  };
}

// Integrity is verified by the Google adapter before this structural validator.
// Validate full chains, rather than accepting a latest-row snapshot as history.
export function validateArchive(archive) {
  if (!plain(archive) || archive.kind !== ARCHIVE_KIND || archive.version !== 2)
    fail(
      "This archive does not support verified recovery. Legacy packages require review of the original workbook.",
    );
  const {
    source,
    job,
    history,
    projects,
    observations,
    originals,
    externalReferences,
  } = archive;
  if (
    !plain(source) ||
    !archiveID(source.workbookId) ||
    !archiveID(source.folderId) ||
    typeof source.provider !== "string" ||
    !source.provider ||
    !["test", "live"].includes(source.mode) ||
    !plain(job) ||
    !archiveID(job.id) ||
    job.provider !== source.provider ||
    job.version !== 1 ||
    !["closed", "cancelled", "declined", "expired", "archived"].includes(
      job.state,
    ) ||
    !Number.isSafeInteger(job.closedAt) ||
    job.closedAt <= 0 ||
    !Number.isSafeInteger(job.archiveAt) ||
    job.archiveAt < job.closedAt ||
    !Array.isArray(job.attachments) ||
    !Array.isArray(history) ||
    !history.length ||
    history.length >= 10000 ||
    !Array.isArray(projects) ||
    !Array.isArray(observations) ||
    !Array.isArray(originals) ||
    !Array.isArray(externalReferences) ||
    !plain(archive.reports) ||
    typeof archive.reports.client !== "string" ||
    typeof archive.reports.provider !== "string"
  )
    fail();
  const ids = new Set();
  for (const [i, e] of history.entries()) {
    if (
      !plain(e) ||
      !archiveID(e.id) ||
      ids.has(e.id) ||
      e.jobId !== job.id ||
      e.revision !== i ||
      e.parent !== i - 1 ||
      !Number.isSafeInteger(e.at) ||
      !["provider", "client", "system"].includes(e.actor) ||
      typeof e.action !== "string" ||
      !plain(e.job) ||
      e.job.id !== job.id ||
      e.job.provider !== source.provider ||
      e.job.kind !== undefined ||
      e.job.version !== 1 ||
      e.job.revision !== i ||
      e.job.updatedAt !== e.at
    )
      fail();
    ids.add(e.id);
  }
  if (stableJSON(history.at(-1).job) !== stableJSON(job)) fail();
  const read = (records, headers) => {
    try {
      const result = readRecordHistory(
        [headers, ...records.map((r) => rowFor(r, headers))],
        headers,
      );
      if (
        result.revisions.length !== records.length ||
        result.revisions.some(
          (r, i) => stableJSON(r) !== stableJSON(records[i]),
        )
      )
        fail();
      return result;
    } catch {
      fail();
    }
  };
  const projectHistory = read(projects, PROJECT_HEADERS),
    noteHistory = read(observations, NOTE_HEADERS);
  if (
    projects.some((r) => r.recordId !== job.id) ||
    observations.some((r) => r.projectId !== job.id) ||
    (job.accepted &&
      (projectHistory.heads.length !== 1 ||
        stableJSON(job.accepted) !==
          stableJSON(
            Object.fromEntries(
              FIELD_KEYS.map((k) => [k, projectHistory.heads[0][k]]),
            ),
          )))
  )
    fail();
  const refs = archiveReferences(job, observations),
    originalIds = new Set();
  let total = 0;
  for (const file of originals) {
    if (
      !plain(file) ||
      !archiveID(file.id) ||
      originalIds.has(file.id) ||
      typeof file.name !== "string" ||
      typeof file.type !== "string" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      file.bytes > ARCHIVE_MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(file.sha256 || "") ||
      stableJSON(file.references) !== stableJSON(refs.files.get(file.id))
    )
      fail("Original file manifest is incomplete.");
    total += file.bytes;
    originalIds.add(file.id);
  }
  if (
    originalIds.size !== refs.files.size ||
    total > ARCHIVE_MAX_TOTAL_BYTES ||
    stableJSON(externalReferences) !== stableJSON(refs.external)
  )
    fail("Original file manifest is incomplete.");
  return { projectHistory, noteHistory };
}

export function archiveImportRecords(archive, operation, at) {
  validateArchive(archive);
  const job = reduceClientJob(
    archive.job,
    {
      action: "archive",
      expectedRevision: archive.job.revision,
    },
    { role: "system" },
    at,
  );
  const event = {
    id: operation,
    jobId: job.id,
    revision: job.revision,
    parent: job.revision - 1,
    at,
    actor: "system",
    action: "archive-import",
    job,
  };
  const projects = [...archive.projects];
  if (job.accepted) {
    const { projectHistory } = validateArchive(archive);
    projects.push({
      ...job.accepted,
      recordId: job.id,
      revisionId: operation + "-project",
      parentRevisionId: projectHistory.heads[0].revisionId,
      updatedAt: new Date(at).toISOString(),
      reviewState: "archived",
    });
  }
  return {
    projects,
    notes: archive.observations,
    events: [...archive.history, event],
    job,
  };
}
