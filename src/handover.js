import {
  WORKFLOW_AREA,
  beforeLeaving,
  measurementEvidence,
  paymentSummary,
} from "./workflow.js";
import { measurementText, measurementNeedsReview } from "./measurements.js";

export function safeReportUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const text = (value, fallback = "Not recorded") => escape(value || fallback);
const date = (value) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : value || "Not recorded";
const status = {
  todo: "To check",
  done: "Checked by provider",
  blocked: "Blocked",
  "not-needed": "Not needed",
};

export function handoverModel(project, plan, notes, options = {}) {
  const records = notes.filter(
    (note) => note.jobId === project.id && note.area !== WORKFLOW_AREA,
  );
  const visible = records.filter(
    (note) =>
      options.includeUnreviewed ||
      (note.reviewed && !measurementNeedsReview(note)),
  );
  return {
    project,
    plan,
    generatedAt: options.generatedAt || new Date().toISOString(),
    origin: options.origin || "Working copy",
    asOf: options.asOf || "",
    warnings: [
      ...beforeLeaving(project, plan, notes),
      ...plan.requirements
        .filter(
          (item) =>
            item.kind === "delivery" &&
            ["todo", "blocked"].includes(item.state),
        )
        .map((item) => ({
          label: item.label,
          detail:
            item.state === "blocked"
              ? item.reason
              : "Delivery task not yet checked",
          state: item.state,
        })),
    ],
    records: visible.map((note) => ({
      ...note,
      readableText: measurementText(note),
    })),
    omitted: records.length - visible.length,
    requirements: plan.requirements.map((item) => ({
      ...item,
      displayState:
        item.kind === "measurement" &&
        item.state === "done" &&
        measurementEvidence(item, notes, project.id).issue
          ? "Reading needs review"
          : status[item.state],
      linked: visible.filter(
        (note) =>
          item.evidence.includes(note.id) ||
          (item.kind === "measurement" &&
            measurementEvidence(item, notes, project.id).records.some(
              (record) => record.id === note.id,
            )),
      ),
    })),
    payment: options.includePayment ? paymentSummary(project) : null,
  };
}

function link(value, label) {
  const url = safeReportUrl(value);
  return url
    ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label || value)}</a>`
    : text(value);
}

export function handoverMarkup(model, images = {}) {
  const { project: p, plan, requirements, records, warnings, omitted } = model;
  const address = [p.address, p.address2, p.city, p.region, p.postal, p.country]
    .filter(Boolean)
    .join(", ");
  const links = ["reference1", "reference2", "document1", "document2"].filter(
    (prefix) => p[`${prefix}Url`],
  );
  return `<article class="handover-report">
    <header class="report-brand"><span aria-hidden="true">🦁</span><div><strong>${text(p.providerName, "StreamLion")}</strong><small>Spatial capture · Job handover</small></div></header>
    <div class="report-title"><p class="report-eyebrow">PROVIDER'S FIELD RECORD</p><h1>${text(p.title, "Untitled project")}</h1><p>${text(p.reference, "No customer reference")}${p.companyName ? ` · ${escape(p.companyName)}` : ""}</p></div>
    <dl class="report-facts"><div><dt>Site</dt><dd>${text(address)}</dd></div><div><dt>Visit</dt><dd>${text(p.startLocal?.replace("T", " at "))}${p.timeZone ? ` · ${escape(p.timeZone)}` : ""}</dd></div><div><dt>Record source</dt><dd>${text(model.origin)}${model.asOf ? ` · checked ${escape(date(model.asOf))}` : ""}</dd></div><div><dt>Report prepared</dt><dd>${escape(date(model.generatedAt))}</dd></div></dl>
    ${warnings.length || omitted ? `<section class="report-attention"><h2>Outstanding work / review</h2><ul>${warnings.map((item) => `<li><strong>${escape(item.label)}</strong> — ${escape(item.detail)}</li>`).join("")}${omitted ? `<li>${omitted} unchecked field record${omitted === 1 ? " is" : "s are"} omitted from the details below. Review in Field notes before sending.</li>` : ""}</ul></section>` : ""}
    <section><h2>Requested work</h2><p class="report-wording">${text(p.scope)}</p>${p.exclusions ? `<h3>Excluded work</h3><p class="report-wording">${escape(p.exclusions)}</p>` : ""}<h3>Requested outputs</h3><p class="report-wording">${text(p.deliverables)}</p></section>
    <section><h2>Requirement record</h2>${requirements.length ? `<table><thead><tr><th>Task / source</th><th>Provider's record</th></tr></thead><tbody>${requirements.map((item) => `<tr><td><strong>${escape(item.label)}</strong>${item.area ? `<p>${escape(item.area)}</p>` : ""}${item.source ? `<blockquote><small>${escape(item.source.name)}${item.source.page ? ` · page ${item.source.page}` : ""}</small>${escape(item.source.quote)}</blockquote>` : ""}</td><td><strong>${escape(item.displayState)}</strong>${item.reason ? `<p class="report-wording">${escape(item.reason)}</p>` : ""}${item.linked.length ? `<small>Evidence: ${item.linked.map((note) => `${escape(note.area)} (${escape(note.id.slice(0, 8))})${!note.reviewed ? " · needs review" : ""}${note.pendingBookId ? " · waiting for Google" : ""}`).join("; ")}</small>` : ""}</td></tr>`).join("")}</tbody></table>` : "<p>No work checklist has been recorded.</p>"}</section>
    ${plan.siteLessons ? `<section><h2>Exceptions and follow-up</h2><p class="report-wording">${escape(plan.siteLessons)}</p></section>` : ""}
    <section><h2>Field evidence and room readings</h2>${
      records.length
        ? records
            .map((note) => {
              const image = images[note.id];
              const validImage =
                typeof image === "string" &&
                /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(
                  image,
                );
              return (
                `<section class="report-evidence"><h3>${text(note.area)} <small>· ${escape(note.id.slice(0, 8))}</small></h3><p class="report-eyebrow">${note.reviewed && !measurementNeedsReview(note) ? "Provider reviewed" : "Needs review"}${note.pendingBookId ? " · waiting for Google" : ""} · ${escape(date(note.createdAt))}</p><p class="report-wording">${text(note.readableText)}</p>${note.sourceText && note.sourceText !== note.text ? `<details open><summary>Original wording</summary><p class="report-wording">${escape(measurementText({ ...note, text: note.sourceText }))}</p></details>` : ""}${validImage ? `<img src="${image}" alt="${escape(`Field photo: ${note.area}`)}" />` : ""}${note.audioUrl ? `<p>${link(note.audioUrl, "Original field file in Drive")}</p>` : note.audioId ? "<small>Original file is held on the capture device; no share link is recorded.</small>" : ""}` +
                "</section>"
              );
            })
            .join("")
        : "<p>No reviewed field evidence is included.</p>"
    }</section>
    <section><h2>Delivery and recorded acceptance</h2><dl class="report-facts"><div><dt>Send to</dt><dd class="report-wording">${text(p.deliveryDestination)}</dd></div><div><dt>Deadline as stated</dt><dd>${text(p.deliveryDeadline)}</dd></div><div><dt>Delivery</dt><dd>${plan.delivery === "not-sent" ? "Not recorded as sent" : `Provider recorded sending · ${escape(date(plan.deliveredAt))}`}</dd></div><div><dt>Acceptance</dt><dd>${plan.delivery === "accepted" ? `Provider recorded customer acceptance · ${escape(date(plan.acceptedAt))}` : "Not recorded"}</dd></div></dl>${links.length || p.driveFolderUrl ? `<h3>Project links</h3><ul>${links.map((prefix) => `<li>${link(p[`${prefix}Url`], p[`${prefix}Name`] || "Project document")}</li>`).join("")}${p.driveFolderUrl ? `<li>${link(p.driveFolderUrl, "Project Drive folder")}</li>` : ""}</ul>` : ""}</section>
    ${
      model.payment
        ? `<section><h2>Payment record</h2><dl class="report-facts">${Object.entries(
            model.payment,
          )
            .filter(([key]) => key !== "overpaid")
            .map(
              ([key, value]) =>
                `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`,
            )
            .join("")}</dl></section>`
        : ""
    }
    <footer class="report-footer">Prepared with StreamLion · Checked items reflect the provider's recorded work. Customer acceptance is a provider entry.</footer>
  </article>`;
}

export const reportStyles = `
.handover-report td > small{display:block;margin-top:8px}
.handover-report{color:#173b2d;background:white;font:15px/1.55 Arial,sans-serif;max-width:900px;margin:auto;padding:36px;overflow-wrap:anywhere}
.handover-report *{box-sizing:border-box}.report-brand{display:flex;align-items:center;gap:12px;border-bottom:2px solid #194f39;padding-bottom:18px}.report-brand>span{font-size:38px}.report-brand strong{font-size:21px}.report-brand small{display:block;color:#52655a}.report-title{padding:28px 0 18px}.handover-report h1{font-size:32px;line-height:1.2;margin:8px 0}.handover-report h2{font-size:21px;margin:0 0 12px}.handover-report h3{font-size:16px;margin:14px 0 8px}.handover-report section{margin:24px 0}.report-eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#52655a}.report-facts{display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;margin:0}.report-facts dt{font-size:12px;color:#52655a;text-transform:capitalize}.report-facts dd{margin:3px 0 0}.report-wording{white-space:pre-wrap}.report-attention{padding:18px;border:1px solid #cfb57a;background:#fff9e9}.report-attention li{margin:8px 0}.handover-report table{width:100%;border-collapse:collapse;table-layout:fixed}.handover-report th{text-align:left;background:#f0f5f1}.handover-report td,.handover-report th{padding:12px;border-bottom:1px solid #dce5df;vertical-align:top}.handover-report td:first-child{width:60%}.handover-report blockquote{margin:12px 0 0;border-left:3px solid #c8d9ce;padding-left:12px;font-size:13px;white-space:pre-wrap}.handover-report blockquote small{display:block;color:#52655a}.report-evidence{border-top:1px solid #dce5df;padding-top:14px}.report-evidence img{display:block;max-width:100%;max-height:340px;object-fit:contain;margin:12px 0}.handover-report a{color:#194f39}.report-footer{border-top:1px solid #dce5df;padding-top:18px;color:#52655a;font-size:11px}
@media(max-width:600px){.handover-report{padding:20px}.report-facts{grid-template-columns:1fr}.handover-report h1{font-size:25px}.handover-report td,.handover-report th{padding:8px}}
@media print{@page{size:auto;margin:16mm}.handover-report{padding:0;font-size:10pt;max-width:none}.report-facts{grid-template-columns:1fr 1fr}.handover-report h1{font-size:23pt}.handover-report h2{break-after:avoid}.handover-report tr,.report-evidence img,.report-brand{break-inside:avoid}.report-evidence{break-inside:auto}.handover-report a{color:inherit}}
`;
export function handoverDocument(model, images) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(model.project.title)} · Job handover</title><style>${reportStyles}</style></head><body>${handoverMarkup(model, images)}</body></html>`;
}
