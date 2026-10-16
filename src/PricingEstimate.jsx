import React from "react";
import { calculatePricing, PRICING_METHODS } from "./provider-pricing.js";
import { estimateMoney } from "./capture-estimate.js";
export function PriceBreakdown({ estimate, label = "Estimated total" }) {
  if (!estimate) return null;
  return (
    <div className="pricing-breakdown">
      {estimate.lines.map((line, i) => (
        <div className="pricing-line" key={line.id || i}>
          <span>
            <strong>{line.name}</strong>
            <small>
              {line.quantity} {line.unit} × {estimate.currency} {line.rate}
            </small>
          </span>
          <strong>{estimateMoney(line.amountCents, estimate.currency)}</strong>
        </div>
      ))}
      {estimate.totalCents != null ? (
        <p className="pricing-total">
          <span>{label}</span>
          <strong>
            {estimateMoney(estimate.totalCents, estimate.currency)}
          </strong>
        </p>
      ) : (
        <p>
          <strong>Provider will prepare a quote.</strong>
          {estimate.lines.length > 0 && (
            <>
              {" "}
              Known extras:{" "}
              {estimateMoney(estimate.subtotalCents, estimate.currency)}; base
              service price is still to be quoted.
            </>
          )}
        </p>
      )}
    </div>
  );
}
export function EstimateInputs({
  config,
  area,
  onArea,
  quantities,
  onQuantities,
  disabled = false,
  areaLabel = "Approximate square footage",
}) {
  return (
    <>
      {config.method !== "quote" && (
        <label>
          {areaLabel}
          <input
            inputMode="numeric"
            type="number"
            min="1"
            step="1"
            max="999999999"
            value={area || ""}
            disabled={disabled}
            onChange={(e) => onArea(e.target.value)}
          />
        </label>
      )}
      {config.extras.map((extra) => (
        <label key={extra.id}>
          {extra.name} · {config.currency} {extra.price} per {extra.unit}
          {extra.required ? " · required" : " · optional"}
          <input
            aria-label={`${extra.name} quantity (${extra.unit})`}
            type="number"
            min={extra.required ? "0.01" : "0"}
            max={extra.maxQuantity}
            step="0.01"
            inputMode="decimal"
            disabled={disabled}
            value={
              quantities[extra.id] ??
              (extra.required ? extra.defaultQuantity : "0")
            }
            onChange={(e) =>
              onQuantities({ ...quantities, [extra.id]: e.target.value || "0" })
            }
          />
          <small>
            Maximum {extra.maxQuantity} {extra.unit};{" "}
            {extra.required
              ? "enter the expected quantity"
              : "0 means not requested"}
            .
          </small>
        </label>
      ))}
    </>
  );
}
export function EstimatePreview({ config, area, quantities }) {
  let estimate, error;
  try {
    estimate = calculatePricing(config, area, quantities);
  } catch (e) {
    error = e.message;
  }
  return error ? (
    <p role="status">{error}</p>
  ) : (
    <PriceBreakdown estimate={estimate} />
  );
}
export function SubmittedPricing({ request }) {
  if (!request) return null;
  const currency = request.pricing?.config.currency;
  return (
    <section className="coord-estimate" aria-label="Submitted pricing">
      <h3>Submitted pricing</h3>
      {request.pricing && (
        <p>
          {request.pricing.name} · pricing version {request.pricing.version}
        </p>
      )}
      {request.estimate ? (
        <PriceBreakdown
          estimate={request.estimate}
          label="Submitted estimate"
        />
      ) : (
        <p>Provider will prepare a quote.</p>
      )}
      {request.budgetCents != null && (
        <p>
          Client-proposed budget:{" "}
          <strong>{estimateMoney(request.budgetCents, currency)}</strong>. This
          is a proposal for provider review.
        </p>
      )}
      <p>
        This saved estimate does not set the agreed fee or authorize work. Later
        pricing changes do not change these submitted amounts.
      </p>
    </section>
  );
}

export function FormPricingControls({
  form,
  profiles,
  available,
  busy,
  update,
}) {
  const profile = profiles.find(
      (p) =>
        p.id ===
        (form.pricing?.profileId || form.intake?.pricingProfile || "default"),
    ),
    target = profile ? profile.id + ":" + profile.version : "quote";
  return (
    <>
      <p>
        Latest published pricing:{" "}
        {profile
          ? `${profile.name} · version ${profile.version} · ${PRICING_METHODS[profile.config.method]}`
          : "Provider prepares a quote"}
        . <a href="/?page=Account">Review prices in Account</a>.
      </p>
      <button
        type="button"
        disabled={busy || available === false || form.pricingKey === target}
        onClick={() =>
          update({
            formId: form.id,
            expectedPricingKey: form.pricingKey || "legacy",
            targetPricingKey: target,
          })
        }
      >
        Update form pricing for future requests
      </button>
    </>
  );
}
