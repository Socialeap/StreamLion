import test from "node:test";
import assert from "node:assert/strict";
import { CoordinationGoogle } from "../../server/coordination-google.js";
import { stableJSON, reduceClientJob } from "../../src/client-workflow.js";
import { makeRevision } from "../../src/workbook.js";
import {
  validateArchive,
  archiveReports,
  archiveReferences,
  sha256Hex,
  archiveFileID,
} from "../../server/coordination-archive.js";
import {
  archiveEnv,
  archiveSource,
  archiveTarget,
  archiveFixture,
  archiveGoogleFixture,
} from "../../test/archive-fixture.js";

test("archive provenance rejects modified, unsigned, cross-account, cross-mode and different-folder packages", async () => {
  const archive = await archiveFixture(),
    google = new CoordinationGoogle(archiveEnv, archiveTarget);
  assert.equal(await google.verifyArchive(archive), archive);
  const edited = structuredClone(archive);
  edited.job.fields.scope = "Unapproved change";
  edited.integrity.digest = await sha256Hex(
    stableJSON(
      Object.fromEntries(
        Object.entries(edited).filter(([k]) => k !== "integrity"),
      ),
    ),
  );
  await assert.rejects(() => google.verifyArchive(edited), /signature/);
  for (const connection of [
    { ...archiveTarget, google_subject: "b" },
    { ...archiveTarget, mode: "live" },
    { ...archiveTarget, folder_id: "other" },
  ])
    await assert.rejects(
      () =>
        new CoordinationGoogle(archiveEnv, connection).verifyArchive(archive),
      /ownership/,
    );
  await assert.rejects(
    () => google.verifyArchive({ ...archive, version: 1 }),
    /Legacy/,
  );
  await assert.rejects(
    () => new CoordinationGoogle({}, archiveTarget).verifyArchive(archive),
    /configuration/,
  );
  assert.equal(
    archiveFileID(
      "https://drive.google.com/file/d/archived-file/view?usp=drive_link",
    ),
    "archived-file",
  );
  assert.throws(
    () => archiveFileID("https://evil.example/file/archive"),
    /Paste/,
  );
});

test("archive chains and original manifests must be complete; client handover excludes private notes", async () => {
  const archive = await archiveFixture();
  validateArchive(archive);
  assert.match(archive.reports.provider, /PRIVATE SOURCE/);
  assert.match(archive.reports.provider, /PRIVATE FIELD NOTE/);
  assert.doesNotMatch(
    archive.reports.client,
    /PRIVATE SOURCE|PRIVATE FIELD NOTE|Original wording/,
  );
  const fork = structuredClone(archive);
  fork.history.push(fork.history[0]);
  assert.throws(() => validateArchive(fork), /history/);
  const disconnected = structuredClone(archive);
  disconnected.observations[0].parentRevisionId = "missing";
  assert.throws(() => validateArchive(disconnected), /history/);
  const missing = structuredClone(archive);
  missing.observations[0].audioUrl =
    "https://drive.google.com/file/d/original/view";
  assert.throws(() => validateArchive(missing), /manifest/);
  const note = {
    ...archive.observations[0],
    audioUrl: "https://external.example/original",
  };
  assert.deepEqual(archiveReferences(archive.job, [note]).external, [
    { recordId: note.recordId, url: note.audioUrl },
  ]);
  assert.doesNotMatch(
    archiveReports(archive.job, [note], "Provider").client,
    /PRIVATE FIELD NOTE/,
  );
});

test("early archival requires a provider, a closed job and an explicit reason before ending access", async () => {
  const { job } = await archiveFixture();
  const command = {
    action: "archive_early",
    expectedRevision: job.revision,
    reason: "Closed work retained",
  };
  assert.throws(
    () => reduceClientJob(job, command, { role: "client" }, 10),
    /Provider/,
  );
  assert.throws(
    () =>
      reduceClientJob(
        { ...job, state: "in_progress", closedAt: null },
        command,
        { role: "provider" },
        10,
      ),
    /closed job/,
  );
  assert.throws(
    () =>
      reduceClientJob(
        job,
        { ...command, reason: " " },
        { role: "provider" },
        10,
      ),
    /recording why/,
  );
  const archived = reduceClientJob(job, command, { role: "provider" }, 10);
  assert.equal(archived.state, "archived");
  assert.equal(archived.archiveAt, 10);
  assert.equal(archived.closedAt, job.closedAt);
  assert.equal(archived.archivalReason, command.reason);
  assert.throws(
    () =>
      reduceClientJob(
        archived,
        { ...command, expectedRevision: archived.revision },
        { role: "provider" },
        11,
      ),
    /closed job/,
  );
});
test("atomic recovery retains unrelated records, verifies target signatures and recovers lost acknowledgment once", async () => {
  const archive = await archiveFixture(),
    f = archiveGoogleFixture();
  const other = makeRevision(
    { ...archive.job.fields, title: "Existing project" },
    null,
    "other-project",
    "draft",
  );
  f.addProject(other);
  f.loseAck();
  const plan = { archive, fileId: "archive-id", at: 10 };
  await assert.rejects(
    () => f.google.importArchive(plan, "restore-op"),
    /lost batch/,
  );
  const counts = f.rows.map((r) => r.length);
  const job = await f.google.importArchive(plan, "restore-op");
  assert.equal(f.writes(), 1);
  assert.equal(job.state, "archived");
  assert.deepEqual(
    f.rows.map((r) => r.length),
    counts,
  );
  const result = await f.google.snapshot();
  assert.equal(result.heads.get(archive.job.id).state, "archived");
  assert.deepEqual(
    result.projects.heads.find((r) => r.recordId === other.recordId),
    other,
  );
  const event = result.events.get("event-original");
  assert.equal(
    await new CoordinationGoogle(archiveEnv, archiveSource).signature(
      event,
      f.rows[2][1][8],
    ),
    false,
  );
});

test("partial import, conflicting target note, newer job history and capacity stop without overwriting", async () => {
  const archive = await archiveFixture(),
    plan = { archive, fileId: "archive-id", at: 10 };
  const partial = archiveGoogleFixture();
  partial.addProject(archive.projects[0]);
  await assert.rejects(
    () => partial.google.importArchive(plan, "restore-op"),
    /partial|conflicts/,
  );
  assert.equal(partial.writes(), 0);
  const conflicting = archiveGoogleFixture();
  conflicting.addNote({
    ...archive.observations[0],
    projectId: "another-job",
    text: "Must keep",
  });
  await assert.rejects(
    () => conflicting.google.importArchive(plan, "restore-op"),
    /partial|conflicts/,
  );
  assert.equal(conflicting.writes(), 0);
  const newer = archiveGoogleFixture();
  await newer.google.importArchive(plan, "restore-op");
  const snapshot = await newer.google.snapshot(),
    prior = snapshot.heads.get(archive.job.id);
  await newer.google.event({
    id: "newer",
    jobId: prior.id,
    revision: prior.revision + 1,
    parent: prior.revision,
    at: 11,
    actor: "provider",
    action: "reopen",
    job: {
      ...prior,
      revision: prior.revision + 1,
      updatedAt: 11,
      state: "in_progress",
    },
  });
  await assert.rejects(
    () => newer.google.importArchive(plan, "restore-op"),
    /partial|conflicts/,
  );
  assert.equal(
    (await newer.google.snapshot()).heads.get(prior.id).state,
    "in_progress",
  );
  const full = archiveGoogleFixture();
  full.rows[3].push(
    ...Array.from({ length: 9999 }, (_, i) => [
      "other-" + i,
      1,
      "file-" + i,
      1,
    ]),
  );
  await assert.rejects(
    () => full.google.importArchive(plan, "restore-op"),
    /capacity/,
  );
  assert.equal(full.writes(), 0);
});

test("Drive originals require private ancestry, exact stored identity and byte hash", async () => {
  const f = archiveGoogleFixture(),
    archive = await archiveFixture();
  const bytes = new Uint8Array([1, 2, 255]),
    digest = await sha256Hex(bytes);
  const props = {
    streamlionNote: "note-a",
    streamlionProject: archive.job.id,
    streamlionBook: archiveSource.workbook_id,
    sha256: digest,
  };
  let publicFile = false,
    changed = false,
    missingParent = false;
  f.google.originalMetadata = async (id) => {
    if (publicFile) throw new Error("original shared");
    return id === "original"
      ? {
          id,
          name: "Field.wav",
          mimeType: "audio/wav",
          size: 3,
          parents: [missingParent ? "unrelated" : "project-folder"],
          appProperties: props,
        }
      : {
          id,
          mimeType: "application/vnd.google-apps.folder",
          parents: [
            id === "project-folder"
              ? "project-files"
              : id === "project-files"
                ? "folder"
                : "outside",
          ],
        };
  };
  f.google.call = async () =>
    new Response(changed ? new Uint8Array([9, 2, 255]) : bytes);
  const refs = [{ kind: "field", id: "note-a" }];
  const expected = await f.google.originalFile("original", refs, archive.job, {
    bytes: 0,
  });
  assert.equal(expected.sha256, digest);
  changed = true;
  await assert.rejects(
    () =>
      f.google.originalFile(
        "original",
        refs,
        archive.job,
        { bytes: 0 },
        expected,
      ),
    /bytes changed/,
  );
  changed = false;
  missingParent = true;
  await assert.rejects(
    () =>
      f.google.originalFile(
        "original",
        refs,
        archive.job,
        { bytes: 0 },
        expected,
      ),
    /location/,
  );
  missingParent = false;
  publicFile = true;
  await assert.rejects(
    () =>
      f.google.originalFile(
        "original",
        refs,
        archive.job,
        { bytes: 0 },
        expected,
      ),
    /shared/,
  );
});
test("archive loading verifies private Drive metadata and checksum before accepting signed provenance", async () => {
  const archive = await archiveFixture(),
    google = new CoordinationGoogle(archiveEnv, archiveTarget);
  google.privateFolder = async () => {};
  let body = stableJSON(archive),
    publicFile = false,
    checksum = await sha256Hex(body),
    reads = 0;
  google.json = async () => ({
    id: "archive-id",
    name: "Archive.json",
    mimeType: "application/json",
    size: new TextEncoder().encode(body).length,
    parents: ["folder"],
    ownedByMe: true,
    permissions: [
      {
        type: publicFile ? "anyone" : "user",
        role: publicFile ? "reader" : "owner",
      },
    ],
    appProperties: { streamlionArchive: "archive-op", checksum },
  });
  google.call = async (url) => {
    assert.equal(
      url,
      "https://www.googleapis.com/drive/v3/files/archive-id?alt=media",
    );
    reads++;
    return new Response(body);
  };
  assert.equal((await google.loadArchive("archive-id")).job.id, archive.job.id);
  publicFile = true;
  await assert.rejects(
    () => google.loadArchive("archive-id"),
    /missing or shared/,
  );
  assert.equal(reads, 1);
  publicFile = false;
  body = body.replace("Archived office", "Changed office");
  await assert.rejects(() => google.loadArchive("archive-id"), /checksum/);
  checksum = await sha256Hex(body);
  await assert.rejects(() => google.loadArchive("archive-id"), /integrity/);
});
