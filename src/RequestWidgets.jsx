// Answer widgets used only by the client request assistant. The shared ones
// (text, form, choice, multi, number) live in SetupWidgets.jsx.
import { useId, useState } from "react";
import { CalendarPlus, X } from "lucide-react";
import { PriceBreakdown } from "./PricingEstimate.jsx";
import { WINDOWS, localDate } from "./request-assistant.js";

const plural = (unit, quantity) =>
  quantity === "1" || /s$|\s/.test(unit) ? unit : `${unit}s`;

// A priced extra: optional ones offer No thanks / the usual amount / another
// amount; required ones ask for the expected quantity.
export function QuantityWidget({ step, value, disabled, error, onSubmit }) {
  const { extra } = step;
  const usual = Number(extra.defaultQuantity) > 0 ? extra.defaultQuantity : "1";
  const [amount, setAmount] = useState(
    value && value !== "0" ? value : extra.required ? usual : "",
  );
  const id = useId();
  return (
    <form
      className="setup-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(amount);
      }}
    >
      {!extra.required && (
        <div className="setup-options" role="group" aria-label={step.title}>
          <button
            type="button"
            className={`setup-option${value === "0" ? " is-previous" : ""}`}
            data-setup-focus
            disabled={disabled}
            onClick={() => onSubmit("0")}
          >
            <span>
              <strong>No thanks</strong>
            </span>
          </button>
          <button
            type="button"
            className={`setup-option${value === usual ? " is-previous" : ""}`}
            disabled={disabled}
            onClick={() => onSubmit(usual)}
          >
            <span>
              <strong>
                Yes · {usual} {plural(extra.unit, usual)}
              </strong>
              <small>
                {step.currency} {extra.price} per {extra.unit}
              </small>
            </span>
          </button>
        </div>
      )}
      <div className="setup-inline-form">
        <label htmlFor={id}>
          {extra.required
            ? `Quantity (${plural(extra.unit, "2")})`
            : `Another amount (${plural(extra.unit, "2")})`}
        </label>
        <input
          id={id}
          data-setup-focus={extra.required ? true : undefined}
          inputMode="decimal"
          value={amount}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setAmount(event.target.value.trim())}
        />
        <button
          className={extra.required ? "primary" : ""}
          disabled={disabled || !amount}
        >
          {extra.required ? "Continue" : "Use amount"}
        </button>
      </div>
    </form>
  );
}

// Up to three dates, each with a time of day, or "I'm flexible".
export function AvailabilityWidget({
  step,
  value,
  disabled,
  error,
  onSubmit,
  today = localDate(),
}) {
  const [slots, setSlots] = useState(() =>
    value?.slots?.length
      ? value.slots.map((slot) => ({ ...slot }))
      : [{ date: "", window: "" }],
  );
  const [flexible, setFlexible] = useState(Boolean(value?.flexible));
  const id = useId();
  const filled = slots.filter((slot) => slot.date || slot.window);
  const change = (index, patch) =>
    setSlots(
      slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  return (
    <form
      className="setup-availability"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ slots: filled, flexible });
      }}
    >
      {slots.map((slot, index) => (
        <fieldset key={index} className="setup-slot" disabled={disabled}>
          <legend>Option {index + 1}</legend>
          <div className="setup-slot-row">
            <label htmlFor={`${id}-${index}`} className="sr-only">
              Date for option {index + 1}
            </label>
            <input
              id={`${id}-${index}`}
              type="date"
              data-setup-focus={index === 0 ? true : undefined}
              min={today}
              value={slot.date}
              aria-invalid={error ? true : undefined}
              onChange={(event) => change(index, { date: event.target.value })}
            />
            {slots.length > 1 && (
              <button
                type="button"
                className="setup-quiet"
                aria-label={`Remove option ${index + 1}`}
                onClick={() => setSlots(slots.filter((_, i) => i !== index))}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            className="setup-segment"
            role="group"
            aria-label={`Time of day for option ${index + 1}`}
          >
            {WINDOWS.map((window) => (
              <button
                key={window.id}
                type="button"
                aria-pressed={slot.window === window.id}
                title={window.detail}
                onClick={() => change(index, { window: window.id })}
              >
                {window.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="setup-dock-actions">
        {slots.length < 3 && (
          <button
            type="button"
            className="setup-add"
            disabled={disabled}
            onClick={() => setSlots([...slots, { date: "", window: "" }])}
          >
            <CalendarPlus size={16} aria-hidden="true" />
            Add another date
          </button>
        )}
        <label className="setup-check">
          <input
            type="checkbox"
            checked={flexible}
            disabled={disabled}
            onChange={(event) => setFlexible(event.target.checked)}
          />
          I’m flexible
        </label>
        <button
          className="primary"
          disabled={disabled || (!filled.length && !flexible)}
        >
          {!filled.length && flexible ? "Continue — I’m flexible" : "Continue"}
        </button>
      </div>
    </form>
  );
}

export function DateWidget({
  step,
  value,
  disabled,
  error,
  onSubmit,
  today = localDate(),
}) {
  const [date, setDate] = useState(typeof value === "string" ? value : "");
  const id = useId();
  return (
    <form
      className="setup-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(date);
      }}
    >
      <label htmlFor={id}>{step.label}</label>
      <input
        id={id}
        type="date"
        data-setup-focus
        min={today}
        value={date}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setDate(event.target.value)}
      />
      <button className="primary" disabled={disabled || !date}>
        Continue
      </button>
    </form>
  );
}

export function EstimateCard({ estimate, brand, disabled, onSubmit }) {
  return (
    <div className="setup-card">
      <div className="setup-estimate" aria-label="Preliminary estimate">
        <PriceBreakdown estimate={estimate} label="Preliminary estimate" />
      </div>
      <p className="setup-hint">
        {brand} reviews scope, travel, taxes and availability before either of
        you agrees anything.
      </p>
      {onSubmit && (
        <div className="setup-dock-actions">
          <button
            type="button"
            className="primary"
            data-setup-focus
            disabled={disabled}
            onClick={() => onSubmit(true)}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
