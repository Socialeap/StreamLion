import React, { useState, useRef } from "react";
import { captureEstimate, estimateMoney } from "./capture-estimate.js";
import { PROJECT_FIELDS } from "./project-schema.js";
import { activeIntakeQuestions } from "./intake-templates.js";
const fieldKeys = [
  "title",
  "propertySizeSqFt",
  "address",
  "address2",
  "city",
  "region",
  "postal",
  "country",
  "scope",
  "accessInstructions",
  "deliverables",
  "proposedTimes",
  "deliveryDeadline",
  "deliveryDestination",
  "notes",
  "requesterName",
  "companyName",
  "contact1Phone",
];
export default function ProspectIntake({ descriptor, token, api }) {
  const attempt = useRef(null);
  const [fields, setFields] = useState({}),
    [email, setEmail] = useState(""),
    [creative, setCreative] = useState(false),
    [propertyType, setPropertyType] = useState(""),
    [complexity, setComplexity] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [receipt, setReceipt] = useState(null);
  const estimate = captureEstimate(
    descriptor.intake?.estimateProfile,
    fields.propertySizeSqFt,
    creative,
  );
  const questions = activeIntakeQuestions(
    { intake: descriptor.intake, fields },
    fields,
  );
  const keys = [
    ...new Set([
      ...fieldKeys.filter(
        (k) =>
          !(descriptor.intake?.questions || []).some((q) => q.field === k) ||
          questions.some((q) => q.field === k),
      ),
      ...questions.map((q) => q.field),
    ]),
  ];
  return (
    <section className="coord-card coord-prospect">
      <p className="eyebrow">
        {descriptor.brand} ·{" "}
        {descriptor.reusable ? "public work-order form" : "private invitation"}
      </p>
      <h2>Estimate & work-order request</h2>
      <p>
        Fill out the details you know and get an estimate. The provider reviews
        scope and availability before either side agrees to work.
        {(!descriptor.reusable || descriptor.verificationRequired) &&
          " This provider requires email confirmation before submission."}
      </p>
      {descriptor.intake && (
        <p>
          <strong>{descriptor.intake.name}</strong> ·{" "}
          {descriptor.intake.description}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const notes = [
              fields.notes,
              propertyType && `Property type: ${propertyType}`,
              complexity && `Capture scope: ${complexity}`,
              descriptor.intake?.estimateProfile &&
                `Creative Direction: ${creative ? "Requested · 6 hours / $900" : "Not requested"}`,
            ]
              .filter(Boolean)
              .join("\n");
            const body = {
              token,
              email,
              fields: { ...fields, notes },
              creative,
            };
            if (descriptor.reusable && !attempt.current)
              attempt.current = {
                ...body,
                visit: descriptor.visit,
                operation: crypto.randomUUID(),
                accessToken: btoa(
                  String.fromCharCode(
                    ...crypto.getRandomValues(new Uint8Array(32)),
                  ),
                )
                  .replaceAll("+", "-")
                  .replaceAll("/", "_")
                  .replaceAll("=", ""),
              };
            const result = await api(
              descriptor.reusable ? "public/submit" : "prospect/request",
              descriptor.reusable ? attempt.current : body,
            );
            setNotice(result.message);
            if (result.url) setReceipt(result);
          } catch (e) {
            if (e.status === 400) attempt.current = null;
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {descriptor.intake?.estimateProfile && (
          <section
            className="coord-estimate"
            aria-label="Preliminary capture estimate"
          >
            <h3>Calculate your estimate</h3>
            <label>
              Approximate square footage
              <input
                inputMode="numeric"
                type="number"
                min="1"
                step="1"
                max="999999999"
                value={fields.propertySizeSqFt || ""}
                onChange={(e) =>
                  setFields({ ...fields, propertySizeSqFt: e.target.value })
                }
              />
            </label>
            <label className="coord-check">
              <input
                type="checkbox"
                checked={creative}
                onChange={(e) => setCreative(e.target.checked)}
              />
              Add Creative Direction · 6 hours / $900
            </label>
            {estimate ? (
              <>
                <p>
                  Capture: {estimateMoney(estimate.captureCents)} · Creative
                  Direction: {estimateMoney(estimate.creativeCents)}
                </p>
                <strong className="coord-estimate-total">
                  Estimated total: {estimateMoney(estimate.totalCents)}
                </strong>
              </>
            ) : (
              <p>
                Enter a whole-number square-foot estimate, or leave it blank for
                provider review.
              </p>
            )}
            <p className="coord-small">
              Preliminary USD estimate. Final scope, access, travel, taxes,
              availability and invoice require provider review. No payment or
              booking occurs here.
            </p>
          </section>
        )}
        <h3>Tell us about the work</h3>
        <div className="coord-fields">
          <label>
            Property type
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
            >
              <option value="">Not known yet</option>
              {[
                "Residential",
                "Commercial / office",
                "Cultural / gallery",
                "Event venue",
                "Hospitality / hotel",
                "Industrial / warehouse",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Capture complexity
            <select
              value={complexity}
              onChange={(e) => setComplexity(e.target.value)}
            >
              <option value="">Please review my details</option>
              {[
                "Standard venue · typically 2–3 hours",
                "Expanded venue · may require a full day",
                "Large facility · may require 2–3 days",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {keys
            .filter(
              (k) =>
                !(
                  descriptor.intake?.estimateProfile && k === "propertySizeSqFt"
                ),
            )
            .map((k) => {
              const f = PROJECT_FIELDS.find((f) => f.key === k),
                q = questions.find((q) => q.field === k);
              if (!f) return null;
              const required = ["requesterName", "address", "scope"].includes(
                k,
              );
              const label =
                k === "title"
                  ? "Project name · optional until agreement"
                  : k === "contact1Phone"
                    ? "Contact phone · optional"
                    : q?.label || f.label;
              const props = {
                value: fields[k] || "",
                disabled: busy || Boolean(attempt.current),
                required,
                maxLength: 6000,
                onChange: (e) => setFields({ ...fields, [k]: e.target.value }),
              };
              return (
                <label key={k}>
                  {label}
                  {required && (
                    <span className="coord-required"> · required</span>
                  )}
                  {q?.help && (
                    <span className="coord-field-help">{q.help}</span>
                  )}
                  {q?.options?.length ? (
                    <select {...props}>
                      <option value="">Not known yet</option>
                      {q.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea {...props} rows={3} />
                  ) : (
                    <input
                      {...props}
                      type={f.type === "url" ? "url" : "text"}
                    />
                  )}
                </label>
              );
            })}
          <label>
            {descriptor.reusable && !descriptor.verificationRequired
              ? "Email · optional for replies"
              : "Email for confirmation"}
            <input
              type="email"
              required={!descriptor.reusable || descriptor.verificationRequired}
              maxLength={254}
              disabled={busy || Boolean(attempt.current)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        <p>
          Your project name can wait until agreement. No work is authorized and
          no payment is due with this request.{" "}
          {descriptor.reusable
            ? "After submission, save your private request link. Unaccepted requests expire after 30 days."
            : "This invitation is for one client."}
        </p>
        <button disabled={busy || Boolean(notice)}>
          {busy
            ? "Submitting…"
            : attempt.current && error
              ? "Retry original submission"
              : descriptor.reusable && !descriptor.verificationRequired
                ? "Submit work-order request"
                : "Send request for email verification"}
        </button>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {receipt && (
          <div>
            <label>
              Private request status link
              <input
                readOnly
                value={receipt.url}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <a className="coord-share-action" href={receipt.url}>
              Open request status
            </a>
            <p>
              Save this link to revisit your request. Anyone with this private
              link can access this request. Access expires{" "}
              {new Date(receipt.expiresAt).toLocaleDateString()} unless the
              provider agrees or extends access.
            </p>
          </div>
        )}
        {notice && !descriptor.reusable && (
          <button
            type="button"
            className="coord-secondary"
            onClick={() => setNotice("")}
          >
            Edit request before verification
          </button>
        )}
      </form>
    </section>
  );
}
