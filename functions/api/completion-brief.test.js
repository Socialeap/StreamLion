import test from "node:test";
import assert from "node:assert/strict";
import {
  completionBrief,
  verifiedCompletionBytes,
} from "../../server/completion-brief.js";
import { sha256Hex } from "../../server/coordination-archive.js";
import { newClientJob } from "../../src/client-workflow.js";

test("client completion references contain protected portal links and omit unreviewed field text", async () => {
  const job = newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 1,
  });
  job.accepted = {
    ...job.fields,
    scope: "Capture lobby",
    deliverables: "Tour",
  };
  job.state = "work_completed";
  job.attachments = [
    { id: "reference", name: "Client <plan>.pdf", visibility: "client" },
    { id: "private", name: "PRIVATE-FILE", visibility: "provider" },
  ];
  const snapshot = {
    notes: {
      heads: [
        {
          recordId: "draft-note",
          projectId: job.id,
          area: "Lobby",
          text: "UNREVIEWED-SECRET",
          reviewState: "draft",
          updatedAt: "2026-10-24T12:00:00Z",
        },
      ],
    },
  };
  const brief = await completionBrief(
    job,
    snapshot,
    "Provider",
    "https://app.example",
  );
  assert.match(
    brief.document,
    /https:\/\/app\.example\/api\/coordination\/client\/file\?job=job-a&amp;id=reference/,
  );
  assert.match(brief.document, /Client &lt;plan&gt;\.pdf/);
  assert.doesNotMatch(brief.document, /UNREVIEWED-SECRET|PRIVATE-FILE/);
});
test("completion download verifies same-size corruption and cancels oversized streams", async () => {
  const bytes = new TextEncoder().encode("reviewed brief");
  const attachment = { bytes: bytes.length, sha256: await sha256Hex(bytes) };
  assert.deepEqual(
    await verifiedCompletionBytes(new Response(bytes), attachment),
    bytes,
  );
  await assert.rejects(
    () => verifiedCompletionBytes(new Response("REVIEWED BRIEF"), attachment),
    /content changed/,
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(attachment.bytes + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () => verifiedCompletionBytes(new Response(stream), attachment),
    /content changed/,
  );
  assert.equal(cancelled, true);
});
