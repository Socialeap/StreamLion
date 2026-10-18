import { EstimateInputs, EstimatePreview } from "./PricingEstimate.jsx";
import { budgetAllowed, pricingKey } from "./provider-pricing.js";
import React, { useState, useRef } from "react";
import { captureEstimate, estimateMoney } from "./capture-estimate.js";
import { PROJECT_FIELDS } from "./project-schema.js";
import { activeIntakeQuestions, chosenAnswers } from "./intake-templates.js";
import BriefPrivacyNotice from "./BriefPrivacyNotice.jsx";
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
export default function ProspectIntake({
  descriptor: initialDescriptor,
  token,
  api,
  initial,
  onShowAssistant,
}) {
  const [pricingNotice, setPricingNotice] = useState("");
  const [descriptor, setDescriptor] = useState(initialDescriptor),
    [quantities, setQuantities] = useState(initial?.quantities || {}),
    [budget, setBudget] = useState(initial?.budget || ""),
    [pricingChanged, setPricingChanged] = useState(false);
  const modernPricing = Object.hasOwn(descriptor, "pricing"),
    config = descriptor.pricing?.config;
  const legacyEstimate =
    !modernPricing && Boolean(descriptor.intake?.estimateProfile);
  const attempt = useRef(null);
  const [fields, setFields] = useState(initial?.fields || {}),
    [email, setEmail] = useState(initial?.email || ""),
    [creative, setCreative] = useState(false),
    [propertyType, setPropertyType] = useState(""),
    [complexity, setComplexity] = useState(""),
    [busy, setBusy] = useState(false),
    [emailLink, setEmailLink] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [verificationUrl, setVerificationUrl] = useState(""),
    [receipt, setReceipt] = useState(null);
  const estimate = captureEstimate(
    legacyEstimate ? descriptor.intake?.estimateProfile : undefined,
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
      {onShowAssistant && (
        <p>
          <button
            type="button"
            className="coord-secondary"
            onClick={onShowAssistant}
          >
            Answer one question at a time instead
          </button>{" "}
          {initial &&
            "Your assistant answers are copied here. Changes on this page stay on this page."}
        </p>
      )}
      <p>
        Your request goes to{" "}
        <strong>{descriptor.branding?.name || descriptor.brand}</strong>.
        StreamLion provides the form and coordination tools.
      </p>
      <p>
        {legacyEstimate || (config && config.method !== "quote")
          ? "Fill out the details you know and preview an estimate using this provider’s prices."
          : "Fill out the details you know. Your provider will prepare a quote."}{" "}
        The provider reviews scope and availability before either side agrees to
        work.
        {(!descriptor.reusable || descriptor.verificationRequired) &&
          " This provider requires email confirmation before submission."}
      </p>
      {descriptor.intake && (
        <p>
          <strong>{descriptor.intake.name}</strong> ·{" "}
          {modernPricing && descriptor.intake.id === "intake-tm-spatial"
            ? "Optional spatial-capture questions. Prices come from this provider’s published pricing profile."
            : descriptor.intake.description}
        </p>
      )}
      <BriefPrivacyNotice client />
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
              legacyEstimate &&
                `Creative Direction: ${creative ? "Requested · 6 hours / $900" : "Not requested"}`,
            ]
              .filter(Boolean)
              .join("\n");
            const body = {
              token,
              email,
              fields: { ...fields, notes },
              creative: legacyEstimate ? creative : false,
              ...(modernPricing
                ? {
                    pricingKey: pricingKey(descriptor),
                    quantities,
                    budget: budgetAllowed(descriptor) ? budget : "",
                  }
                : {}),
            };
            if (descriptor.reusable && !attempt.current)
              attempt.current = {
                ...body,
                ...(email.trim() &&
                !descriptor.verificationRequired &&
                emailLink
                  ? { emailLink: true }
                  : {}),
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
            if (result.verificationRequired && result.verificationUrl)
              setVerificationUrl(result.verificationUrl);
            if (result.url) setReceipt(result);
          } catch (e) {
            if (e.status === 400) attempt.current = null;
            if (e.code === "pricing_changed") setPricingChanged(true);
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {modernPricing && (
          <section
            className="coord-estimate"
            aria-label="Provider pricing estimate"
          >
            <h3>
              {descriptor.pricing
                ? `Pricing · ${descriptor.pricing.name}`
                : "Provider will prepare a quote"}
            </h3>
            {descriptor.pricing && (
              <p>
                Published pricing version {descriptor.pricing.version} ·{" "}
                {config.currency}. This estimate uses the provider’s saved
                rates.
              </p>
            )}
            {config && (
              <>
                <EstimateInputs
                  config={config}
                  area={fields.propertySizeSqFt}
                  onArea={(area) =>
                    setFields({ ...fields, propertySizeSqFt: area })
                  }
                  quantities={quantities}
                  onQuantities={setQuantities}
                  disabled={busy || Boolean(attempt.current)}
                />
                <EstimatePreview
                  config={config}
                  area={fields.propertySizeSqFt}
                  quantities={quantities}
                />
                {budgetAllowed(descriptor) && (
                  <label>
                    Your proposed budget (optional, {config.currency})
                    <input
                      inputMode="decimal"
                      disabled={busy || Boolean(attempt.current)}
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="Amount you would like the provider to consider"
                    />
                    <small>
                      A proposal for review; this does not replace the
                      calculated estimate or agree a fee.
                    </small>
                  </label>
                )}
              </>
            )}
            <p>
              Preliminary estimate. Final scope, travel, taxes, availability and
              price require provider review. No payment or booking occurs here.
            </p>
          </section>
        )}
        {pricingNotice && <p role="status">{pricingNotice}</p>}
        {pricingChanged && (
          <div role="alert">
            <p>
              Pricing changed before your request was saved. Your answers are
              kept. Review the current prices before submitting.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const updated = await api(
                    descriptor.reusable ? "public/open" : "prospect/open",
                    { token },
                  );
                  setDescriptor(updated);
                  setQuantities((old) =>
                    Object.fromEntries(
                      Object.entries(old).filter(([id]) =>
                        updated.pricing?.config.extras.some((e) => e.id === id),
                      ),
                    ),
                  );
                  attempt.current = null;
                  setPricingChanged(false);
                  setError("");
                  setPricingNotice(
                    "Pricing refreshed. Your answers are kept; review the updated estimate before submitting.",
                  );
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Review updated pricing
            </button>
          </div>
        )}
        {legacyEstimate && (
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
                disabled={busy || Boolean(attempt.current)}
                onChange={(e) =>
                  setFields({ ...fields, propertySizeSqFt: e.target.value })
                }
              />
            </label>
            <label className="coord-check">
              <input
                type="checkbox"
                checked={creative}
                disabled={busy || Boolean(attempt.current)}
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
              disabled={busy || Boolean(attempt.current)}
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
              disabled={busy || Boolean(attempt.current)}
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
                  (legacyEstimate || (config && config.method !== "quote")) &&
                  k === "propertySizeSqFt"
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
              if (q?.multiple) {
                const chosen = chosenAnswers(fields[k] || "");
                return (
                  <fieldset key={k} className="coord-choices">
                    <legend>{label}</legend>
                    {q.help && (
                      <span className="coord-field-help">{q.help}</span>
                    )}
                    {q.options.map((option) => (
                      <label key={option} className="coord-check">
                        <input
                          type="checkbox"
                          checked={chosen.includes(option)}
                          disabled={props.disabled}
                          onChange={(e) =>
                            setFields({
                              ...fields,
                              [k]: q.options
                                .filter((o) =>
                                  o === option
                                    ? e.target.checked
                                    : chosen.includes(o),
                                )
                                .join("\n"),
                            })
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                );
              }
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
        {descriptor.reusable &&
          !descriptor.verificationRequired &&
          email.trim() && (
            <label className="coord-check">
              <input
                type="checkbox"
                checked={emailLink}
                disabled={busy || Boolean(attempt.current)}
                onChange={(e) => setEmailLink(e.target.checked)}
              />
              Also email my private status link to this address
            </label>
          )}
        <p>
          Your project name can wait until agreement. No work is authorized and
          no payment is due with this request.{" "}
          {descriptor.reusable
            ? "After submission, save your private request link. Unaccepted requests expire after 30 days."
            : "This invitation is for one client."}
        </p>
        <button disabled={busy || Boolean(notice) || pricingChanged}>
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
        {verificationUrl && (
          <div>
            <a href={verificationUrl}>
              Recover this request / resend confirmation
            </a>
            <p>
              Save this recovery link. If the email is missing or expired, open
              it and enter the same email address. Your saved answers stay with
              this request. Email verification is still required for access.
            </p>
          </div>
        )}
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
              {receipt.linkEmailed === true &&
                "We’ve also emailed this link to you. "}
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
