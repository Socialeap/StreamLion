import { useId, useState } from "react";
import {
  ArrowUp,
  Check,
  FileText,
  FolderSync,
  HardDrive,
  Inbox,
  MessageCircle,
  Minus,
  Moon,
  PackageCheck,
  Plus,
  Ruler,
  Sparkles,
  Sun,
  Upload,
  Volume2,
} from "lucide-react";
import ProviderBrand from "./ProviderBrand.jsx";

const ICONS = {
  "focus:requests": Inbox,
  "focus:briefs": FileText,
  "focus:field": Ruler,
  "focus:handover": PackageCheck,
  "storage:google": FolderSync,
  "storage:device": HardDrive,
  "siteCopy:yes": HardDrive,
  "units:imperial": Ruler,
  "units:metric": Ruler,
  "theme:light": Sun,
  "theme:dark": Moon,
  "aiUses:brief": FileText,
  "aiUses:ask": MessageCircle,
  "aiUses:helper": Sparkles,
  "aiVoice:aloud": Volume2,
};
const iconFor = (step, option) => ICONS[`${step.id}:${option.id}`];

function FieldError({ id, children }) {
  return children ? (
    <small id={id} className="setup-field-error">
      {children}
    </small>
  ) : null;
}

export function TextWidget({
  step,
  value,
  answers,
  disabled,
  error,
  onSubmit,
}) {
  const [text, setText] = useState(typeof value === "string" ? value : "");
  const id = useId();
  const suggestions = (step.suggestions?.(answers) || []).filter(
    (item) => item && item !== text.trim(),
  );
  return (
    <form
      className="setup-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text);
      }}
    >
      {suggestions.length > 0 && (
        <div className="setup-suggestions">
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              className="setup-chip"
              disabled={disabled}
              onClick={() => onSubmit(item)}
            >
              Use “{item}”
            </button>
          ))}
        </div>
      )}
      <div className="setup-composer-row">
        <label className="sr-only" htmlFor={id}>
          {step.label}
        </label>
        <input
          id={id}
          data-setup-focus
          value={text}
          maxLength={step.id === "business" ? 100 : 80}
          placeholder={step.placeholder}
          autoComplete={step.autoComplete || "off"}
          enterKeyHint="send"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          className="primary setup-send"
          aria-label="Send"
          disabled={disabled || !text.trim()}
        >
          <ArrowUp size={20} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

export function FormWidget({
  step,
  value,
  disabled,
  fieldErrors = {},
  onSubmit,
}) {
  const [draft, setDraft] = useState(() => ({ ...value }));
  const id = useId();
  return (
    <form
      className="setup-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="setup-form-grid">
        {step.fields.map((field, index) => {
          const fieldId = `${id}-${field.key}`;
          const problem = fieldErrors[field.key];
          return (
            <div className="setup-form-field" key={field.key}>
              <label htmlFor={fieldId}>
                {field.label}
                {!field.required && <em> · optional</em>}
              </label>
              <input
                id={fieldId}
                data-setup-focus={index === 0 ? true : undefined}
                type={field.type || "text"}
                inputMode={field.type === "url" ? "url" : undefined}
                autoComplete={field.autoComplete}
                placeholder={field.placeholder}
                value={draft[field.key] || ""}
                disabled={disabled}
                required={field.required}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${fieldId}-error` : undefined}
                onChange={(event) =>
                  setDraft({ ...draft, [field.key]: event.target.value })
                }
              />
              <FieldError id={`${fieldId}-error`}>{problem}</FieldError>
            </div>
          );
        })}
      </div>
      <div className="setup-dock-actions">
        <button className="primary" disabled={disabled}>
          Continue
        </button>
      </div>
    </form>
  );
}

export function ChoiceWidget({ step, options, value, disabled, onSubmit }) {
  return (
    <div
      className={`setup-options${options.length > 2 ? " setup-options-list" : ""}`}
      role="group"
      aria-label={step.title}
    >
      {options.map((option, index) => {
        const Icon = iconFor(step, option);
        return (
          <button
            key={option.id}
            type="button"
            data-setup-focus={index === 0 ? true : undefined}
            className={`setup-option${value === option.id ? " is-previous" : ""}`}
            disabled={disabled || option.disabled}
            onClick={() => onSubmit(option.id)}
          >
            {Icon && <Icon size={20} aria-hidden="true" />}
            <span>
              <strong>{option.label}</strong>
              {option.detail && <small>{option.detail}</small>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MultiWidget({ step, options, value, disabled, onSubmit }) {
  const [selected, setSelected] = useState(() =>
    (Array.isArray(value) ? value : []).filter((id) =>
      options.some((option) => option.id === id),
    ),
  );
  const toggle = (id) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id],
    );
  return (
    <div className="setup-multi">
      <div className="setup-tags" role="group" aria-label={step.title}>
        {options.map((option, index) => {
          const Icon = iconFor(step, option);
          const on = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              data-setup-focus={index === 0 ? true : undefined}
              className="setup-tag"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(option.id)}
            >
              <span className="setup-tag-mark" aria-hidden="true">
                {on ? <Check size={14} /> : Icon ? <Icon size={14} /> : null}
              </span>
              <span>
                {option.label}
                {option.detail && <small>{option.detail}</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="setup-dock-actions">
        <span className="setup-count" aria-hidden="true">
          {selected.length ? `${selected.length} selected` : ""}
        </span>
        {step.optional && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSubmit([])}
          >
            {step.optional}
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={disabled || !selected.length}
          onClick={() => onSubmit(selected)}
        >
          Confirm selection
        </button>
      </div>
    </div>
  );
}

function bump(value, delta, places) {
  const number = Number(String(value || "0").replace(/^\./, "0."));
  const scale = 10 ** places;
  const next = Math.max(0, Math.round((number + delta) * scale) / scale);
  return next.toFixed(places);
}
export function NumberWidget({
  step,
  value,
  answers,
  disabled,
  error,
  onSubmit,
}) {
  const [amount, setAmount] = useState(String(value ?? ""));
  const id = useId();
  const places = (step.step || "1").split(".")[1]?.length || 0;
  return (
    <form
      className="setup-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(amount);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {step.label}
      </label>
      <div className="setup-number">
        <button
          type="button"
          aria-label="Decrease"
          disabled={disabled}
          onClick={() => setAmount(bump(amount, -Number(step.step), places))}
        >
          <Minus size={18} aria-hidden="true" />
        </button>
        <input
          id={id}
          data-setup-focus
          inputMode="decimal"
          value={amount}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-unit`}
          onChange={(event) => setAmount(event.target.value.trim())}
        />
        <span className="setup-unit" id={`${id}-unit`}>
          {step.unit?.(answers)}
        </span>
        <button
          type="button"
          aria-label="Increase"
          disabled={disabled}
          onClick={() => setAmount(bump(amount, Number(step.step), places))}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="setup-dock-actions">
        <button className="primary" disabled={disabled || !amount}>
          Continue
        </button>
      </div>
    </form>
  );
}

export function CurrencyWidget({
  step,
  options,
  value,
  disabled,
  error,
  onSubmit,
}) {
  const known = options.some((option) => option.id === value);
  const [other, setOther] = useState(known ? "" : value || "");
  const id = useId();
  return (
    <div className="setup-multi">
      <div className="setup-tags" role="group" aria-label={step.title}>
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            data-setup-focus={index === 0 ? true : undefined}
            className={`setup-tag${value === option.id ? " is-previous" : ""}`}
            disabled={disabled}
            onClick={() => onSubmit(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <form
        className="setup-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(other);
        }}
      >
        <label htmlFor={id}>{step.label}</label>
        <input
          id={id}
          value={other}
          maxLength={3}
          placeholder="e.g., CHF"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setOther(event.target.value.toUpperCase())}
        />
        <button disabled={disabled || other.length !== 3}>Use code</button>
      </form>
    </div>
  );
}

export function TiersWidget({ value, answers, disabled, onSubmit }) {
  const [tiers, setTiers] = useState(() =>
    (value || []).map((tier) => ({ ...tier })),
  );
  const flat = answers.pricingMethod === "flat";
  const unit = flat ? answers.currency : `${answers.currency} / sq ft`;
  const change = (index, patch) =>
    setTiers(
      tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)),
    );
  const resize = (count) => {
    if (count === tiers.length) return;
    setTiers(
      count === 2
        ? [tiers[0], { ...tiers.at(-1), upTo: "" }]
        : [
            tiers[0],
            {
              upTo: String(Number(tiers[0].upTo || 5000) + 10000),
              price: tiers.at(-1).price,
            },
            { ...tiers.at(-1), upTo: "" },
          ],
    );
  };
  return (
    <form
      className="setup-tiers"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(tiers);
      }}
    >
      <div className="setup-segment" role="group" aria-label="Number of bands">
        {[2, 3].map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={tiers.length === count}
            disabled={disabled}
            onClick={() => resize(count)}
          >
            {count === 2 ? "Two bands" : "Three bands"}
          </button>
        ))}
      </div>
      {tiers.map((tier, index) => {
        const from = index ? Number(tiers[index - 1].upTo || 0) + 1 : 1;
        const last = index === tiers.length - 1;
        return (
          <fieldset key={index} className="setup-tier" disabled={disabled}>
            <legend>
              Band {index + 1} · from {from.toLocaleString("en-US")} sq ft
              {last ? " and above" : ""}
            </legend>
            {!last && (
              <label>
                Up to (sq ft)
                <input
                  data-setup-focus={index === 0 ? true : undefined}
                  inputMode="numeric"
                  value={tier.upTo}
                  onChange={(event) =>
                    change(index, { upTo: event.target.value.trim() })
                  }
                />
              </label>
            )}
            <label>
              {flat ? `Project fee (${unit})` : `Rate (${unit})`}
              <input
                inputMode="decimal"
                value={tier.price}
                onChange={(event) =>
                  change(index, { price: event.target.value.trim() })
                }
              />
            </label>
          </fieldset>
        );
      })}
      <div className="setup-dock-actions">
        <button className="primary" disabled={disabled}>
          Continue
        </button>
      </div>
    </form>
  );
}

const SHAPES = [
  ["rounded", "Rounded"],
  ["square", "Square"],
  ["rectangle", "Wide"],
];
export function LogoWidget({
  value,
  answers,
  disabled,
  convertLogo,
  onSubmit,
}) {
  const [logo, setLogo] = useState(value?.logo || ""),
    [shape, setShape] = useState(value?.shape || "rounded"),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setProblem("");
    try {
      setLogo(await convertLogo(file));
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  }
  const locked = disabled || busy;
  return (
    <div className="setup-logo">
      {logo ? (
        <ProviderBrand
          branding={{ name: answers.business, logo, shape, website: "" }}
          recipient
        />
      ) : null}
      <div className="setup-logo-row">
        <label className="setup-upload" aria-disabled={locked || undefined}>
          <Upload size={18} aria-hidden="true" />
          {busy ? "Preparing logo…" : logo ? "Choose another" : "Choose logo"}
          <input
            className="sr-only"
            type="file"
            data-setup-focus
            accept="image/png,image/jpeg,image/webp"
            disabled={locked}
            onChange={upload}
          />
        </label>
        {logo && (
          <div className="setup-segment" role="group" aria-label="Logo shape">
            {SHAPES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={shape === id}
                disabled={locked}
                onClick={() => setShape(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {problem && (
        <p className="setup-error" role="alert">
          {problem}
        </p>
      )}
      <div className="setup-dock-actions">
        <button type="button" disabled={locked} onClick={() => onSubmit(null)}>
          Skip for now
        </button>
        <button
          type="button"
          className="primary"
          disabled={locked || !logo}
          onClick={() => onSubmit({ logo, shape })}
        >
          Use this logo
        </button>
      </div>
    </div>
  );
}
