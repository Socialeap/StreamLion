import React, { useState } from "react";
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
  const [fields, setFields] = useState({}),
    [email, setEmail] = useState(""),
    [creative, setCreative] = useState(false),
    [propertyType, setPropertyType] = useState(""),
    [complexity, setComplexity] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
      <p className="eyebrow">{descriptor.brand} · private invitation</p>
      <h2>Estimate & work-order request</h2>
      <p>
        Your provider can now see that this form was opened. Submit the details
        you know, then verify your email. The provider reviews scope and
        availability before either side agrees to work.
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
            const result = await api("prospect/request", {
              token,
              email,
              fields: { ...fields, notes },
              creative,
            });
            setNotice(result.message);
          } catch (e) {
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
                disabled: busy,
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
            Email for private project access
            <input
              type="email"
              required
              maxLength={254}
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        <p>
          Your project name can wait until agreement. Email verification
          connects this request to one client; the share link stops accepting
          new requests after verification. No work is authorized and no payment
          is due with this request.
        </p>
        <button disabled={busy || Boolean(notice)}>
          {busy
            ? "Sending verification…"
            : "Send request for email verification"}
        </button>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {notice && (
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
