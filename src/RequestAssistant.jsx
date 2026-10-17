import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleCheck,
  Copy,
  ExternalLink,
  FileText,
  LoaderCircle,
  MailCheck,
  RotateCcw,
} from "lucide-react";
import {
  AssistantMessage,
  ChatHeader,
  ReviewCard,
  UserMessage,
  focusAnswer,
  scrollToLatest,
} from "./ChatParts.jsx";
import {
  ChoiceWidget,
  FormWidget,
  MultiWidget,
  NumberWidget,
  TextWidget,
} from "./SetupWidgets.jsx";
import {
  AvailabilityWidget,
  DateWidget,
  EstimateCard,
  QuantityWidget,
} from "./RequestWidgets.jsx";
import {
  REQUEST_KEEP_DAYS,
  brandName,
  clearRequest,
  emailRequired,
  estimateSummary,
  localDate,
  newRequest,
  readRequest,
  requestBody,
  requestEstimate,
  requestFields,
  requestFlow,
  requestQuantities,
  writeRequest,
} from "./request-assistant.js";
import { budgetAllowed } from "./provider-pricing.js";

const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

function StatusLink({ receipt, brand }) {
  const [copied, setCopied] = useState("");
  const input = useRef(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(receipt.url);
      setCopied("Link copied.");
    } catch {
      input.current?.select();
      setCopied("Select the link and copy it.");
    }
  }
  return (
    <div className="setup-card request-link">
      <label>
        <span>Your private status link</span>
        <input
          ref={input}
          readOnly
          value={receipt.url}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <div className="setup-dock-actions">
        <button type="button" className="primary" onClick={copy}>
          <Copy size={16} aria-hidden="true" />
          Copy link
        </button>
        <a className="setup-link-button" href={receipt.url}>
          <ExternalLink size={16} aria-hidden="true" />
          Open request status
        </a>
      </div>
      {copied && (
        <p role="status" className="setup-hint">
          {copied}
        </p>
      )}
      <p className="setup-hint">
        Save this link: it’s how you follow {brand}’s reply from any device.
        Anyone with it can see this request, so keep it private.
        {receipt.expiresAt &&
          ` Access expires ${new Date(receipt.expiresAt).toLocaleDateString()} unless ${brand} agrees or extends it.`}
      </p>
    </div>
  );
}
function NextSteps({ brand }) {
  return (
    <ol className="request-next">
      <li>{brand} reviews your request and replies on your status page.</li>
      <li>
        You agree the brief together. Nothing is booked before you both approve
        it.
      </li>
      <li>{brand} confirms the visit time with you.</li>
      <li>Your results are delivered to the same private page.</li>
    </ol>
  );
}

export default function RequestAssistant({
  descriptor: initialDescriptor,
  token,
  api,
  onShowForm,
  storage = globalThis.localStorage,
  today = localDate(),
}) {
  const [descriptor, setDescriptor] = useState(initialDescriptor);
  const flow = useMemo(() => requestFlow(descriptor), [descriptor]);
  const [state, setState] = useState(
    () => readRequest(token, storage) || newRequest(),
  );
  const stateRef = useRef(state);
  const [editing, setEditing] = useState(""),
    [error, setError] = useState(""),
    [fieldErrors, setFieldErrors] = useState({}),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [pricingChanged, setPricingChanged] = useState(false),
    [storageWarning, setStorageWarning] = useState(false);
  const feed = useRef(null),
    dock = useRef(null);
  const brand = brandName(descriptor);
  const ctx = { today };
  const walked = flow.walk(state, ctx);
  const { answers, history, current } = walked;
  const progress = flow.stageProgress(walked, flow.stages);
  const complete = !current;
  const receipt = complete ? answers.review : null;
  // A send that may have reached the provider keeps its answers fixed until
  // it is retried, so a second attempt cannot create a duplicate request.
  const locked = Boolean(state.attempt) && !complete;

  useEffect(() => {
    scrollToLatest(feed.current);
  }, [current?.id, history.length, notice]);
  useEffect(() => {
    if (!current || busy) return;
    focusAnswer(dock.current);
  }, [current?.id, editing]);

  function commit(next) {
    stateRef.current = next;
    setState(next);
    setStorageWarning(!writeRequest(token, next, storage));
  }
  function fail(e) {
    setError(e.message);
    setFieldErrors(e.fields || {});
  }
  function submit(value) {
    setError("");
    setFieldErrors({});
    try {
      commit(flow.answerStep(stateRef.current, current.id, value, ctx));
      setEditing("");
    } catch (e) {
      fail(e);
    }
  }
  function edit(id) {
    setError("");
    setFieldErrors({});
    setNotice("");
    setEditing(id);
    commit(flow.editStep(stateRef.current, id));
  }
  function cancelEdit() {
    const id = editing;
    if (!id || current?.id !== id) return;
    try {
      commit(
        flow.answerStep(
          stateRef.current,
          id,
          stateRef.current.answers[id],
          ctx,
        ),
      );
      setError("");
      setFieldErrors({});
    } catch {
      /* the previous answer no longer applies; keep the question open */
    }
    setEditing("");
  }
  function restart(message) {
    if (!window.confirm(message)) return;
    clearRequest(token, storage);
    const next = newRequest();
    stateRef.current = next;
    setState(next);
    setEditing("");
    setError("");
    setFieldErrors({});
    setNotice("");
    setPricingChanged(false);
  }
  async function send() {
    const reusable = descriptor.reusable;
    let attempt = stateRef.current.attempt;
    if (reusable && !attempt) {
      attempt = {
        ...requestBody(descriptor, answers, token),
        visit: descriptor.visit,
        operation: crypto.randomUUID(),
        accessToken: randomToken(),
      };
      commit({ ...stateRef.current, attempt });
    }
    setBusy("Sending your request…");
    setError("");
    setNotice("");
    try {
      const result = await api(
        reusable ? "public/submit" : "prospect/request",
        reusable ? attempt : requestBody(descriptor, answers, token),
      );
      const sent = {
        message: result.message || "Request sent.",
        confirm: Boolean(result.verificationRequired) || !reusable,
        ...(result.url ? { url: result.url, expiresAt: result.expiresAt } : {}),
      };
      commit(flow.answerStep(stateRef.current, "review", sent, ctx));
    } catch (e) {
      if (e.status === 400) {
        const { attempt: _discarded, ...rest } = stateRef.current;
        commit(rest);
      }
      if (e.code === "pricing_changed") setPricingChanged(true);
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function resend() {
    setBusy("Sending the email again…");
    setError("");
    try {
      const result = await api(
        descriptor.reusable ? "public/submit" : "prospect/request",
        descriptor.reusable
          ? stateRef.current.attempt
          : requestBody(descriptor, answers, token),
      );
      setNotice(result.message || "Sent again.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function refreshPricing() {
    setBusy("Loading the updated prices…");
    setError("");
    try {
      const updated = await api(
        descriptor.reusable ? "public/open" : "prospect/open",
        { token },
      );
      setDescriptor(updated);
      const { attempt: _discarded, ...rest } = stateRef.current;
      // Show the estimate again so the new prices are seen before sending.
      commit(flow.editStep(rest, "estimate"));
      setPricingChanged(false);
      setNotice(
        "Prices updated. Your answers are kept; check the new estimate before sending.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  function showForm() {
    onShowForm({
      fields: requestFields(descriptor, answers),
      email: answers.contact?.email || "",
      quantities: requestQuantities(descriptor, answers),
      budget: budgetAllowed(descriptor) ? answers.budget || "" : "",
    });
  }

  const disabled = !!busy;
  const estimate = requestEstimate(descriptor, answers);
  const lastHistory = history.at(-1)?.step.id;
  function widget() {
    if (!current) return null;
    const value = flow.suggestedValue(state, current, answers, ctx);
    const key = `${current.id}:${editing}`;
    const common = {
      step: current,
      value,
      answers,
      disabled,
      error,
      fieldErrors,
      onSubmit: submit,
    };
    const options = current.options?.(answers, ctx) || [];
    switch (current.kind) {
      case "text":
        return <TextWidget key={key} {...common} />;
      case "form":
        return <FormWidget key={key} {...common} />;
      case "choice":
        return <ChoiceWidget key={key} {...common} options={options} />;
      case "multi":
        return <MultiWidget key={key} {...common} options={options} />;
      case "number":
        return <NumberWidget key={key} {...common} />;
      case "quantity":
        return <QuantityWidget key={key} {...common} />;
      case "availability":
        return <AvailabilityWidget key={key} {...common} today={today} />;
      case "date":
        return <DateWidget key={key} {...common} today={today} />;
      case "estimate":
        return (
          <EstimateCard
            estimate={estimate}
            brand={brand}
            disabled={disabled}
            onSubmit={submit}
          />
        );
      case "review":
        return (
          <div className="setup-card">
            {descriptor.pricing?.config && (
              <p className="request-estimate-line">
                {estimateSummary(descriptor, answers)}
              </p>
            )}
            <ul className="setup-plan">
              <li>
                <CircleCheck size={16} aria-hidden="true" />
                Your request goes to {brand}. No work is authorized and no
                payment is due.
              </li>
              {emailRequired(descriptor) && (
                <li>
                  <MailCheck size={16} aria-hidden="true" />
                  We’ll email {answers.contact?.email || "you"} a link to
                  confirm it first.
                </li>
              )}
              {descriptor.reusable && (
                <li>
                  <CircleCheck size={16} aria-hidden="true" />
                  Requests {brand} hasn’t accepted expire after 30 days.
                </li>
              )}
            </ul>
            {locked && (
              <p className="setup-notice" role="status">
                Your request may already have reached {brand}. Retry sending to
                confirm it before changing anything.
              </p>
            )}
            {pricingChanged && (
              <div className="setup-notice" role="alert">
                <p>
                  {brand} changed their prices before your request was saved.
                  Your answers are kept.
                </p>
                <div className="setup-dock-actions">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={refreshPricing}
                  >
                    Review updated prices
                  </button>
                </div>
              </div>
            )}
            <div className="setup-dock-actions">
              <button
                type="button"
                className="primary"
                data-setup-focus
                disabled={disabled || pricingChanged}
                onClick={send}
              >
                {locked
                  ? "Retry sending"
                  : emailRequired(descriptor)
                    ? "Send & confirm my email"
                    : "Send request"}
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <main className="setup-screen request-screen" aria-labelledby="setup-title">
      <ChatHeader
        title={brand}
        label="Request progress"
        branding={descriptor.branding}
        percent={progress.percent}
        status={
          complete
            ? receipt?.confirm
              ? "Check your email"
              : "Request sent"
            : `Step ${progress.stage + 1} of ${flow.stages.length} · ${progress.label}`
        }
      >
        <button
          type="button"
          className="setup-quiet"
          disabled={disabled}
          onClick={() =>
            restart(
              complete
                ? "Start a new request? This request stays with the provider; this device forgets it."
                : "Start over? Your answers on this device are cleared.",
            )
          }
        >
          <RotateCcw size={16} aria-hidden="true" />
          <span>{complete ? "New request" : "Start over"}</span>
        </button>
        {!complete && !locked && onShowForm && (
          <button
            type="button"
            className="setup-quiet"
            disabled={disabled}
            onClick={showForm}
          >
            <FileText size={16} aria-hidden="true" />
            <span>One-page form</span>
          </button>
        )}
      </ChatHeader>
      <div
        className="setup-feed"
        ref={feed}
        role="log"
        aria-live="polite"
        aria-label="Request conversation"
      >
        <ol>
          {history.map(({ step, value }) =>
            step.id === "review" ? null : (
              <Fragment key={step.id}>
                <AssistantMessage
                  lead={step.prompt(answers, ctx).lead}
                  text={step.prompt(answers, ctx).text}
                  branding={descriptor.branding}
                />
                <UserMessage
                  step={step}
                  value={value}
                  answers={answers}
                  fresh={step.id === lastHistory}
                  onEdit={
                    step.editable === false || disabled || locked || complete
                      ? null
                      : () => edit(step.id)
                  }
                />
              </Fragment>
            ),
          )}
          {current && (
            <AssistantMessage
              {...current.prompt(answers, ctx)}
              branding={descriptor.branding}
              fresh
            >
              {current.kind === "review" && (
                <ReviewCard
                  stages={flow.stages}
                  history={history}
                  answers={answers}
                  disabled={disabled || locked}
                  onEdit={edit}
                />
              )}
            </AssistantMessage>
          )}
          {complete && receipt?.confirm && (
            <AssistantMessage
              fresh
              branding={descriptor.branding}
              text={`Thanks, ${answers.name}! Please check your inbox.`}
              hint={`${receipt.message} The confirmation link expires in 20 minutes. Can’t find it? Check your spam folder, or send it again.`}
            />
          )}
          {complete && !receipt?.confirm && (
            <AssistantMessage
              fresh
              branding={descriptor.branding}
              text={`Thanks, ${answers.name}! Your request is with ${brand}.`}
              hint={receipt?.url ? undefined : receipt?.message}
            >
              {receipt?.url && <StatusLink receipt={receipt} brand={brand} />}
              <p className="setup-plan-title">What happens next</p>
              <NextSteps brand={brand} />
            </AssistantMessage>
          )}
        </ol>
      </div>
      <section
        className="setup-dock"
        ref={dock}
        aria-label={complete ? "Next steps" : "Your answer"}
        onKeyDown={(event) => {
          if (event.key === "Escape" && editing) {
            event.preventDefault();
            cancelEdit();
          }
        }}
      >
        {storageWarning && (
          <p className="setup-notice" role="status">
            This browser couldn’t save your answers. Finish in one go, or allow
            site storage for this page.
          </p>
        )}
        {editing && current?.id === editing && (
          <p className="setup-editing">
            Editing your answer ·{" "}
            <button type="button" onClick={cancelEdit}>
              Keep the previous answer
            </button>
          </p>
        )}
        {busy && (
          <p role="status" className="setup-status">
            <LoaderCircle size={18} aria-hidden="true" /> {busy}
          </p>
        )}
        {notice && (
          <p role="status" className="setup-notice">
            {notice}
          </p>
        )}
        {error && !Object.keys(fieldErrors).length && (
          <p role="alert" className="setup-error">
            {error}
          </p>
        )}
        {complete ? (
          <div className="setup-dock-actions setup-finish">
            {receipt?.confirm && (
              <>
                {!descriptor.reusable && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setNotice("");
                      commit(flow.reopen(stateRef.current));
                    }}
                  >
                    Change something first
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  data-setup-focus
                  disabled={disabled}
                  onClick={resend}
                >
                  Send the email again
                </button>
              </>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                restart(
                  "Clear this request from this device? It stays with the provider.",
                )
              }
            >
              Clear from this device
            </button>
          </div>
        ) : (
          widget()
        )}
        <p className="request-footnote">
          StreamLion provides this form for {brand}.{" "}
          {complete
            ? `This device remembers this request for ${REQUEST_KEEP_DAYS} days.`
            : `Your answers stay on this device for ${REQUEST_KEEP_DAYS} days until you send them.`}
        </p>
      </section>
    </main>
  );
}
