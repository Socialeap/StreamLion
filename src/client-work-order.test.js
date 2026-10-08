import test from "node:test";
import assert from "node:assert/strict";
import { newClientJob } from "./client-workflow.js";
import { clientWorkOrder } from "./client-work-order.js";
test("downloaded work order escapes user wording and includes only client-visible records", () => {
  const job = newClientJob({
    id: "test",
    provider: "private-provider",
    clientEmail: "client@example.com",
    title: "<script>alert(1)</script>",
    now: 1,
  });
  job.fields.scope = "Exact clearance 6 7/16 inches";
  job.intake = { name: '<img src="https://tracker.example">', version: 2 };
  job.fields.sourceNotes = "provider-only source";
  job.fields.driveFolderUrl = "https://drive.google.com/private-folder";
  job.questions = [
    { text: '<img src="https://tracker.example">', resolved: false },
  ];
  job.attachments = [
    {
      visibility: "provider",
      name: "Private capture",
      driveId: "secret-drive-id",
    },
    { visibility: "client", name: "Shared plan.pdf", driveId: "second-secret" },
  ];
  const html = clientWorkOrder(job, {
    brand: "Provider & Co",
    generatedAt: "2026-10-08T12:00:00.000Z",
  });
  assert.match(html, /Exact clearance 6 7\/16 inches/);
  assert.match(html, /Provider &amp; Co/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=/);
  assert.match(html, /Service: &lt;img src=.*intake version 2/);
  assert.match(html, /has not been agreed by both parties/);
  assert.match(html, /provider-reported/);
  assert.match(html, /Shared plan.pdf/);
  assert.doesNotMatch(
    html,
    /<script>|<img|private-provider|provider-only source|private-folder|Private capture|secret-drive-id|second-secret/,
  );
});
