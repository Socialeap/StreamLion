import { CLIENT_FIELDS } from "./client-workflow.js";
import { PROJECT_FIELDS } from "./project-schema.js";

const visible = new Set([
  ...CLIENT_FIELDS,
  "startLocal",
  "endLocal",
  "timeZone",
  "appointmentStatus",
  "offeredFee",
  "agreedFee",
  "currency",
  "paymentTerms",
  "paidAmount",
  "paidDate",
]);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const terms = (fields) =>
  PROJECT_FIELDS.filter((f) => visible.has(f.key) && fields?.[f.key])
    .map((f) => `<dt>${escape(f.label)}</dt><dd>${escape(fields[f.key])}</dd>`)
    .join("");

export function clientWorkOrder(
  job,
  { brand = "Your provider", generatedAt = new Date().toISOString() } = {},
) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(job.fields.title)} · Work order</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#173e31;margin:40px auto;padding:0 24px;max-width:900px}h1{line-height:1.2}dt{font-weight:700;margin-top:18px}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.notice{padding:16px;background:#f3f6f1;border:1px solid #d3dcd0}li{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}.notice{background:transparent}}</style></head><body>
<p>StreamLion · ${escape(brand)}</p><h1>${escape(job.fields.title)}</h1>
<p>Work order version ${escape(job.revision)} · ${escape(job.state.replaceAll("_", " "))}</p>
${job.intake ? `<p>Service: ${escape(job.intake.name)} · intake version ${escape(job.intake.version)}</p>` : ""}
<p>Last project update: ${escape(new Date(job.updatedAt).toISOString())}<br>Downloaded: ${escape(generatedAt)}</p>
<p class="notice">This is the shared project record at the stated version. Unsaved device edits and provider-only notes are excluded. Payment information is provider-reported; bank settlement is not connected.</p>
${job.accepted ? `<h2>Agreed scope and arrangements</h2><dl>${terms(job.accepted)}</dl>` : `<p class="notice">This draft has not been agreed by both parties.</p>`}
${job.proposal ? `<p class="notice">A proposed revision is awaiting agreement. Existing agreed terms remain active.</p>` : ""}
<h2>Current shared information</h2><dl>${terms(job.fields)}</dl>
${
  job.questions?.some((q) => !q.resolved)
    ? `<h2>Open questions</h2><ul>${job.questions
        .filter((q) => !q.resolved)
        .map((q) => `<li>${escape(q.text)}</li>`)
        .join("")}</ul>`
    : ""
}
<h2>Delivery</h2><p>${job.deliveryAccepted ? "Delivery acknowledged by the client." : job.state === "delivered" ? "Provider marked delivered; client acknowledgement is outstanding." : "Client acknowledgement of delivery has not been recorded."}</p>
<h2>Shared files</h2><ul>${
    (job.attachments || [])
      .filter((a) => a.visibility === "client")
      .map((a) => `<li>${escape(a.name)}</li>`)
      .join("") || "<li>No shared attachments recorded.</li>"
  }</ul>
<p>Download attachments separately from Files in the protected project portal.${job.archiveAt ? ` Client portal access ends ${escape(new Date(job.archiveAt).toISOString())}.` : ""} Keep this copy in protected storage.</p></body></html>`;
}
export function downloadClientWorkOrder(job, options) {
  const blob = new Blob([clientWorkOrder(job, options)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `StreamLion-work-order-${job.fields.title.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "project"}-v${job.revision}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
