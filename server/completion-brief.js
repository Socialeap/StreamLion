import { handoverModel, handoverDocument } from "../src/handover.js";
import { readWorkflow, WORKFLOW_AREA } from "../src/workflow.js";
import { clientView, CoordinationError } from "../src/client-workflow.js";
import { sha256Hex } from "./coordination-archive.js";

// Use the verified Google heads, never a browser-supplied report or private
// project fields. The exact bytes reviewed by the provider are the bytes sent.
export async function completionBrief(job, snapshot, brand, origin = "") {
  if (
    !job.accepted ||
    !["confirmed", "in_progress", "work_completed"].includes(job.state)
  )
    throw new CoordinationError(
      "Complete the agreed job before delivering its Completion Brief.",
      409,
    );
  const fields = clientView(job).accepted;
  const project = { ...fields, id: job.id, providerName: brand };
  const heads = snapshot.notes.heads.filter((n) => n.projectId === job.id);
  if (
    heads.some((n) => n.area === WORKFLOW_AREA && n.reviewState !== "reviewed")
  )
    throw new CoordinationError(
      "Review and save the project checklist before preparing its Completion Brief.",
      409,
    );
  const notes = heads.map((n) => ({
    id: n.recordId,
    jobId: n.projectId,
    area: n.area,
    text: n.text,
    sourceText: n.sourceText,
    audioUrl: n.audioUrl,
    reviewed: n.reviewState === "reviewed",
    createdAt: n.updatedAt,
  }));
  const plan = readWorkflow(notes, project);
  const generatedAt = new Date(
    Math.max(job.updatedAt, ...heads.map((n) => Date.parse(n.updatedAt))),
  ).toISOString();
  const model = handoverModel(project, plan, notes, {
    generatedAt,
    origin: "Saved Google project records",
    asOf: generatedAt,
  });
  // A saved checklist can have private, unfinished drafts; report markup uses
  // the reviewed requirement records and excludes those drafts and raw fields.
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const files = job.attachments.filter(
    (a) => a.visibility === "client" && a.kind !== "completion",
  );
  const references = files.length
    ? `<section class="handover-report"><h2>Shared project references</h2><ul>${files
        .map((a) => {
          const path =
            "/api/coordination/client/file?job=" +
            encodeURIComponent(job.id) +
            "&id=" +
            encodeURIComponent(a.id);
          return `<li>${origin ? `<a href="${escape(new URL(path, origin).href)}">${escape(a.name)}</a>` : escape(a.name)}</li>`;
        })
        .join(
          "",
        )}</ul><p>Shared files require your client portal session. Original private field-file references may need separate provider access.</p></section>`
    : "";
  const document = handoverDocument(model).replace(
    "</body>",
    references + "</body>",
  );
  const bytes = new TextEncoder().encode(document);
  if (bytes.length > 512 * 1024)
    throw new CoordinationError(
      "The Completion Brief exceeds 512 KiB. Keep your records and reduce the report before delivery.",
      413,
    );
  return {
    document,
    hash: await sha256Hex(bytes),
    generatedAt,
    bytes: bytes.length,
  };
}

export async function verifiedCompletionBytes(response, attachment) {
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > attachment.bytes || size > 512 * 1024) {
      await reader.cancel();
      throw new CoordinationError(
        "Completion Brief content changed. Ask the provider to review the original.",
        409,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (
    size !== attachment.bytes ||
    (await sha256Hex(bytes)) !== attachment.sha256
  )
    throw new CoordinationError(
      "Completion Brief content changed. Ask the provider to review the original.",
      409,
    );
  return bytes;
}
