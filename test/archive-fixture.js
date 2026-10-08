import { newClientJob, stableJSON } from "../src/client-workflow.js";
import {
  rowFor,
  PROJECT_HEADERS,
  NOTE_HEADERS,
  makeRevision,
} from "../src/workbook.js";
import {
  CoordinationGoogle,
  EVENT_HEADERS,
  ARCHIVE_HEADERS,
} from "../server/coordination-google.js";
import { archiveReports, sha256Hex } from "../server/coordination-archive.js";

export const archiveEnv = {
  GOOGLE_TOKEN_ENCRYPTION_KEY: "synthetic-archive-key",
};
export const archiveSource = {
  id: "source",
  google_subject: "a",
  mode: "test",
  workbook_id: "book-source",
  folder_id: "folder",
  client_brand: "Synthetic provider",
  revoked: 0,
  expires_at: 9999999999999,
};
export const archiveTarget = {
  ...archiveSource,
  id: "target",
  workbook_id: "book-target",
};
export async function signArchive(
  payload,
  env = archiveEnv,
  connection = archiveSource,
) {
  const digest = await sha256Hex(stableJSON(payload));
  return {
    ...payload,
    integrity: {
      digest,
      signature: await new CoordinationGoogle(env, connection).signature({
        kind: payload.kind,
        version: payload.version,
        digest,
      }),
    },
  };
}
export async function archiveFixture(env = archiveEnv, source = archiveSource) {
  const job = newClientJob({
    id: "job-archive",
    provider: source.google_subject,
    clientEmail: "synthetic@example.com",
    title: "Archived office",
    now: 1,
  });
  Object.assign(job.fields, {
    scope: "Office capture",
    address: "100 Example Street",
    city: "Sample City",
    requesterName: "Sample Client",
    accessInstructions: "Meet at the lobby",
    deliverables: "Reviewed 3D tour and floor plan",
    sourceNotes: "PRIVATE SOURCE",
    approxHours: "3",
  });
  job.accepted = { ...job.fields };
  job.state = "closed";
  job.closedAt = 2;
  job.archiveAt = 3;
  job.updatedAt = 2;
  const project = makeRevision(job.accepted, null, job.id, "reviewed");
  const note = makeRevision(
    {
      projectId: job.id,
      area: "Room",
      text: "PRIVATE FIELD NOTE",
      sourceText: "Original wording",
      audioUrl: "",
    },
    null,
    "note-a",
    "reviewed",
  );
  const history = [
    {
      id: "event-original",
      jobId: job.id,
      revision: 0,
      parent: -1,
      at: job.updatedAt,
      actor: "provider",
      action: "create",
      job,
    },
  ];
  return signArchive(
    {
      kind: "streamlion.client.archive",
      version: 2,
      source: {
        workbookId: source.workbook_id,
        folderId: source.folder_id,
        provider: source.google_subject,
        mode: source.mode,
      },
      job,
      history,
      projects: [project],
      observations: [note],
      originals: [],
      externalReferences: [],
      reports: archiveReports(job, [note], source.client_brand),
      retention: "Originals retained.",
    },
    env,
    source,
  );
}
export function archiveGoogleFixture(
  connection = archiveTarget,
  env = archiveEnv,
) {
  const google = new CoordinationGoogle(env, connection);
  const rows = [
    [PROJECT_HEADERS],
    [NOTE_HEADERS],
    [EVENT_HEADERS],
    [ARCHIVE_HEADERS],
  ];
  let writes = 0,
    loseAck = false;
  google.privateFolder = google.privateWorkbook = async () => {};
  google.append = async (tab, values) =>
    rows[
      [
        "Projects",
        "Observations",
        "CoordinationEvents",
        "ArchiveIndex",
      ].indexOf(tab)
    ].push(values);
  google.json = async (url, options) => {
    if (url.endsWith("?fields=sheets.properties"))
      return {
        sheets: [
          "Projects",
          "Observations",
          "CoordinationEvents",
          "ArchiveIndex",
        ].map((title, sheetId) => ({ properties: { title, sheetId } })),
      };
    if (url.includes("/values:batchGet?"))
      return {
        valueRanges: rows.map((values) => ({
          values: values.map((r) => {
            let end = r.length;
            while (end && (r[end - 1] === "" || r[end - 1] == null)) end--;
            return r.slice(0, end);
          }),
        })),
      };
    if (url.endsWith(":batchUpdate")) {
      const body = JSON.parse(options.body);
      for (const { appendCells } of body.requests) {
        if (!appendCells) throw new Error("Only append requests allowed");
        rows[appendCells.sheetId].push(
          ...appendCells.rows.map((r) =>
            r.values.map((v) => v.userEnteredValue.stringValue),
          ),
        );
      }
      writes++;
      if (loseAck) {
        loseAck = false;
        throw new Error("synthetic lost batch acknowledgment");
      }
      return {};
    }
    throw new Error("Unexpected synthetic Google request: " + url);
  };
  return {
    google,
    rows,
    writes: () => writes,
    loseAck: () => {
      loseAck = true;
    },
    addProject: (revision) => rows[0].push(rowFor(revision, PROJECT_HEADERS)),
    addNote: (revision) => rows[1].push(rowFor(revision, NOTE_HEADERS)),
  };
}
