import { Fragment, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  FolderPlus,
  FolderSearch,
  FolderSync,
  LoaderCircle,
  Pencil,
  RotateCcw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import {
  STAGES,
  answerStep,
  editStep,
  newSetup,
  readSetup,
  reopenSetup,
  setupProfile,
  stageProgress,
  suggestedValue,
  walk,
  writeSetup,
} from "./setup-assistant.js";
import {
  ChoiceWidget,
  CurrencyWidget,
  FormWidget,
  LogoWidget,
  MultiWidget,
  NumberWidget,
  TextWidget,
  TiersWidget,
} from "./SetupWidgets.jsx";
import { brandingAPI, prepareLogo } from "./ProviderBrandingSettings.jsx";
import { pricingAPI } from "./ProviderPricingSettings.jsx";
import { validateBranding } from "./provider-branding.js";
import { loadGoogleConfig } from "./google-config.js";
import { saveTheme } from "./theme.js";
import {
  connectGoogle,
  createWorkbook,
  googleAccount,
  googleFolderId,
  hasGoogleSession,
  moveWorkbookToFolder,
  pickWorkbook,
  readWorkbook,
} from "./google.js";

export const googleActions = {
  connect: connectGoogle,
  createWorkbook,
  moveWorkbookToFolder,
  pickWorkbook,
  readWorkbook,
  hasSession: hasGoogleSession,
  account: googleAccount,
  folderId: googleFolderId,
};

function initialSetup() {
  const saved = readSetup();
  if (!saved) return newSetup();
  return saved.status === "complete" ? reopenSetup(saved) : saved;
}
function Avatar() {
  return (
    <span className="setup-avatar" aria-hidden="true">
      <span className="workspace-lion" />
    </span>
  );
}
function AssistantMessage({ text, hint, fresh, children }) {
  return (
    <li className={`setup-message setup-assistant${fresh ? " is-new" : ""}`}>
      <Avatar />
      <div className="setup-bubble">
        {text && <p>{text}</p>}
        {hint && <p className="setup-hint">{hint}</p>}
        {children}
      </div>
    </li>
  );
}
function AnswerText({ value }) {
  return Array.isArray(value) ? (
    <span className="setup-answer-lines">
      {value.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </span>
  ) : (
    <span>{value}</span>
  );
}
function UserMessage({ step, value, answers, automatic, fresh, onEdit }) {
  return (
    <li
      className={`setup-message setup-user${automatic ? " is-automatic" : ""}${fresh ? " is-new" : ""}`}
    >
      <div className="setup-bubble">
        {automatic && <CircleCheck size={16} aria-hidden="true" />}
        {step.id === "logo" && value?.logo ? (
          <span className="setup-answer-logo">
            <img
              src={value.logo}
              alt=""
              className={`provider-logo provider-logo--${value.shape}`}
            />
            Logo added
          </span>
        ) : (
          <AnswerText value={step.summary(value, answers)} />
        )}
      </div>
      {onEdit && (
        <button
          type="button"
          className="setup-edit"
          aria-label={`Edit ${step.title.toLowerCase()}`}
          onClick={onEdit}
        >
          <Pencil size={13} aria-hidden="true" />
          Edit
        </button>
      )}
    </li>
  );
}

const REVIEW_GROUPS = STAGES.map((title, stage) => ({ title, stage }));
function ReviewCard({ history, answers, disabled, onEdit }) {
  return (
    <div className="setup-review">
      {REVIEW_GROUPS.map(({ title, stage }) => {
        const rows = history.filter(
          ({ step }) => step.stage === stage && step.id !== "review",
        );
        if (!rows.length) return null;
        return (
          <section key={title} aria-label={title}>
            <h3>{title}</h3>
            <dl>
              {rows.map(({ step, value }) => (
                <div key={step.id}>
                  <dt>{step.title}</dt>
                  <dd>
                    {step.id === "logo" && value?.logo ? (
                      <img
                        src={value.logo}
                        alt="Your logo"
                        className={`provider-logo provider-logo--${value.shape}`}
                      />
                    ) : (
                      <AnswerText value={step.summary(value, answers)} />
                    )}
                  </dd>
                  {step.editable !== false && (
                    <button
                      type="button"
                      className="setup-edit"
                      disabled={disabled}
                      aria-label={`Edit ${step.title.toLowerCase()}`}
                      onClick={() => onEdit(step.id)}
                    >
                      <Pencil size={13} aria-hidden="true" />
                      Edit
                    </button>
                  )}
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
function applyPlan(profile, connected) {
  const plan = [];
  if (connected && profile.business)
    plan.push(
      `Save “${profile.business}”${profile.website ? ", your website" : ""}${profile.logo ? " and your logo" : ""} to your client request pages`,
    );
  if (connected && profile.pricing)
    plan.push("Publish this pricing as the default for new request forms");
  if (!connected && (profile.business || profile.pricing))
    plan.push(
      "Keep your branding and pricing on this device. Connect Google later to publish them from Account",
    );
  if (profile.business)
    plan.push("Start new projects with your business name and email");
  return plan;
}

export default function SetupAssistant({
  connected = false,
  account = "",
  checking = false,
  bookId = "",
  workbookReady = false,
  siteCopy = false,
  notice = "",
  onWorkbook,
  onSiteCopy,
  onFinish,
  onExit,
  google = googleActions,
  brandingApi = brandingAPI,
  pricingApi = pricingAPI,
  convertLogo = prepareLogo,
  loadConfig = loadGoogleConfig,
}) {
  const [state, setState] = useState(initialSetup);
  const stateRef = useRef(state);
  const [editing, setEditing] = useState(""),
    [error, setError] = useState(""),
    [fieldErrors, setFieldErrors] = useState({}),
    [busy, setBusy] = useState(""),
    [storageWarning, setStorageWarning] = useState(false),
    [results, setResults] = useState(null),
    [online, setOnline] = useState(() => navigator.onLine !== false),
    [config, setConfig] = useState({ loading: true, value: null }),
    [configAttempt, setConfigAttempt] = useState(0),
    [, setGoogleTick] = useState(0);
  const feed = useRef(null),
    dock = useRef(null),
    createdBook = useRef(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setConfig({ loading: true, value: null });
    loadConfig(controller.signal)
      .then((value) => setConfig({ loading: false, value }))
      .catch(() => {
        if (!controller.signal.aborted)
          setConfig({ loading: false, value: null, failed: true });
      });
    return () => controller.abort();
  }, [configAttempt, loadConfig]);

  const live = connected || google.hasSession();
  const ctx = {
    online,
    connected: live,
    account: account || google.account() || "",
    checking,
    googleAvailable:
      config.loading || config.failed ? undefined : !!config.value?.clientId,
    workbookReady: live && workbookReady,
    bookId,
    siteCopy,
    locale: navigator.language,
  };
  const walked = walk(state, ctx);
  const { answers, history, current } = walked;
  const progress = stageProgress(walked);
  const complete = !current;

  useEffect(() => {
    const element = feed.current;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    element?.scrollTo?.({
      top: element.scrollHeight,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [current?.id, history.length, results]);
  useEffect(() => {
    if (!current || busy) return;
    dock.current
      ?.querySelector("[data-setup-focus]:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [current?.id, editing]);

  function commit(next) {
    stateRef.current = next;
    setState(next);
    setStorageWarning(!writeSetup(next));
  }
  function fail(e) {
    setError(e.message);
    setFieldErrors(e.fields || {});
  }
  async function submit(value) {
    const step = current;
    setError("");
    setFieldErrors({});
    try {
      // Validate first so no side effect runs for an invalid answer.
      step.validate(value, answers, ctx);
      if (step.id === "theme") saveTheme(value);
      if (step.id === "siteCopy" && value === "yes") {
        setBusy("Saving an offline copy on this device…");
        await onSiteCopy();
      }
      commit(answerStep(stateRef.current, step.id, value, ctx));
      setEditing("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  function edit(id) {
    setError("");
    setFieldErrors({});
    setResults(null);
    setEditing(id);
    commit(editStep(stateRef.current, id));
  }
  function cancelEdit() {
    const id = editing;
    if (!id || current?.id !== id) return;
    try {
      commit(
        answerStep(stateRef.current, id, stateRef.current.answers[id], ctx),
      );
      setError("");
      setFieldErrors({});
    } catch {
      /* the previous answer no longer applies; keep the question open */
    }
    setEditing("");
  }
  function chooseDevice() {
    const reopened = editStep(stateRef.current, "storage");
    commit(answerStep(reopened, "storage", "device", ctx));
    setError("");
  }
  async function connectWithPopup() {
    setBusy("Waiting for Google…");
    setError("");
    try {
      await google.connect(config.value.clientId);
      setGoogleTick((tick) => tick + 1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function chooseWorkbook(how) {
    const start = ctx;
    setError("");
    setBusy(
      how === "created"
        ? "Creating your StreamLion folder and workbook…"
        : "Opening Google’s workbook chooser…",
    );
    try {
      let id;
      if (how === "created") {
        // Retrying after a partial failure finishes the same workbook.
        const created = createdBook.current || (await google.createWorkbook());
        createdBook.current = created;
        await google.moveWorkbookToFolder(created.spreadsheetId);
        id = created.spreadsheetId;
      } else {
        id = await google.pickWorkbook(config.value);
        if (!id) return;
      }
      setBusy("Checking your workbook…");
      const data = await google.readWorkbook(id);
      await onWorkbook(id, data);
      createdBook.current = null;
      commit(
        answerStep(
          stateRef.current,
          "workbook",
          { bookId: id, how, folderId: google.folderId() || "" },
          start,
        ),
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function publish(profile) {
    const done = [];
    try {
      const current = await brandingApi();
      if (current.account && ctx.account && current.account !== ctx.account)
        throw new Error("Your Google account changed. Reopen Account first.");
      if (!current.available)
        done.push({
          ok: false,
          text: "Business branding awaits activation. Your answers are kept and prefilled in Account.",
        });
      else {
        const saved = current.branding || {};
        const branding = validateBranding({
          name: profile.business,
          website: profile.website || saved.website || "",
          logo: profile.logo?.logo || saved.logo || "",
          shape: profile.logo ? profile.logo.shape : saved.shape || "rounded",
        });
        await brandingApi(
          { branding, version: current.version },
          current.subject,
        );
        done.push({
          ok: true,
          text: "Business branding saved to your client pages",
        });
      }
    } catch (e) {
      done.push({
        ok: false,
        text: `Business branding wasn’t saved: ${e.message} Your answers are kept for Account.`,
      });
    }
    if (profile.pricing)
      try {
        const list = await pricingApi();
        if (list.account && ctx.account && list.account !== ctx.account)
          throw new Error("Your Google account changed. Reopen Account first.");
        if (!list.available)
          done.push({
            ok: false,
            text: "Pricing setup awaits activation. Your rates are kept and prefilled in Account.",
          });
        else {
          const saved = list.profiles.find((p) => p.id === "default");
          await pricingApi(
            {
              id: "default",
              name: saved?.name || "Default pricing",
              version: saved?.version || 0,
              // Named extras are kept; they are edited in Account.
              config: {
                ...profile.pricing,
                extras: saved?.config?.extras || [],
              },
            },
            list.subject,
          );
          done.push({
            ok: true,
            text: "Default pricing published for new request forms",
          });
        }
      } catch (e) {
        done.push({
          ok: false,
          text: `Pricing wasn’t published: ${e.message} Your rates are kept for Account.`,
        });
      }
    return done;
  }
  async function finish() {
    const profile = setupProfile(stateRef.current);
    const start = ctx;
    setError("");
    setBusy("Saving your setup…");
    try {
      const done =
        start.connected && profile.business ? await publish(profile) : [];
      commit(answerStep(stateRef.current, "review", true, start));
      setResults(done);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  function restart() {
    if (
      !window.confirm(
        "Start setup over? Your answers are cleared. Google sign-in, workbooks and projects are not changed.",
      )
    )
      return;
    setEditing("");
    setError("");
    setFieldErrors({});
    setResults(null);
    commit(newSetup());
  }

  const disabled = !!busy;
  const prompt = (step) => step.prompt(answers, ctx);
  const lastHistory = history.at(-1)?.step.id;
  function widget() {
    if (!current) return null;
    const value = suggestedValue(state, current, answers, ctx);
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
      case "currency":
        return <CurrencyWidget key={key} {...common} options={options} />;
      case "tiers":
        return <TiersWidget key={key} {...common} />;
      case "logo":
        return <LogoWidget key={key} {...common} convertLogo={convertLogo} />;
      case "google":
        return (
          <div className="setup-card">
            <ul className="setup-assurances">
              <li>
                <ShieldCheck size={18} aria-hidden="true" />
                StreamLion can open only the files it creates or that you choose
                in Google Drive.
              </li>
              <li>
                <FolderSync size={18} aria-hidden="true" />
                Your projects stay in your own Sheets and Drive.
              </li>
              <li>
                <Clock size={18} aria-hidden="true" />
                Your answers are saved on this device while you sign in.
              </li>
            </ul>
            {notice && (
              <p className="setup-notice" role="alert">
                {notice}
              </p>
            )}
            {checking ? (
              <p role="status" className="setup-status">
                <LoaderCircle size={18} aria-hidden="true" /> Checking your
                Google connection…
              </p>
            ) : !online ? (
              <p className="setup-status">
                <WifiOff size={18} aria-hidden="true" /> You’re offline. Connect
                Google when you’re back online, or keep going on this device.
              </p>
            ) : config.loading ? (
              <p role="status" className="setup-status">
                <LoaderCircle size={18} aria-hidden="true" /> Loading Google
                sign-in…
              </p>
            ) : config.failed || !config.value?.clientId ? (
              <div className="setup-status">
                <p>
                  {config.failed
                    ? "Couldn’t load Google sign-in. Check your connection and try again."
                    : "Google sign-in isn’t available in this StreamLion app right now."}
                </p>
                {config.failed && (
                  <button
                    type="button"
                    onClick={() => setConfigAttempt((n) => n + 1)}
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : null}
            <div className="setup-dock-actions">
              <button type="button" disabled={disabled} onClick={chooseDevice}>
                Use this device instead
              </button>
              {online &&
                !checking &&
                config.value?.clientId &&
                (config.value.persistentEnabled ? (
                  <a
                    className="setup-link-button primary"
                    data-setup-focus
                    href="/api/google/start"
                  >
                    Continue with Google
                  </a>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    data-setup-focus
                    disabled={disabled}
                    onClick={connectWithPopup}
                  >
                    Continue with Google
                  </button>
                ))}
            </div>
          </div>
        );
      case "workbook":
        return (
          <div className="setup-options" role="group" aria-label="Workbook">
            <button
              type="button"
              className="setup-option"
              data-setup-focus
              disabled={disabled}
              onClick={() => chooseWorkbook("created")}
            >
              <FolderPlus size={20} aria-hidden="true" />
              <span>
                <strong>Create a new workbook</strong>
                <small>Recommended · sets up your StreamLion folder too</small>
              </span>
            </button>
            <button
              type="button"
              className="setup-option"
              disabled={
                disabled || !config.value?.apiKey || !config.value?.appId
              }
              onClick={() => chooseWorkbook("picked")}
            >
              <FolderSearch size={20} aria-hidden="true" />
              <span>
                <strong>Choose an existing workbook</strong>
                <small>
                  {config.value?.apiKey && config.value?.appId
                    ? "Opens Google’s file chooser"
                    : "Temporarily unavailable"}
                </small>
              </span>
            </button>
          </div>
        );
      case "review": {
        const plan = applyPlan(setupProfile(state), live);
        return (
          <div className="setup-card">
            {plan.length > 0 && (
              <>
                <p className="setup-plan-title">
                  When you save, StreamLion will:
                </p>
                <ul className="setup-plan">
                  {plan.map((item) => (
                    <li key={item}>
                      <CircleCheck size={16} aria-hidden="true" />
                      {item}.
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="setup-dock-actions">
              <button
                type="button"
                className="primary"
                data-setup-focus
                disabled={disabled}
                onClick={finish}
              >
                Save &amp; finish
              </button>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  }

  return (
    <main className="setup-screen" aria-labelledby="setup-title">
      <header className="setup-header">
        <div className="setup-heading">
          <Avatar />
          <div>
            <h1 id="setup-title">Setup assistant</h1>
            <p>
              {complete
                ? "All set"
                : `Step ${progress.stage + 1} of ${STAGES.length} · ${progress.label}`}
            </p>
          </div>
        </div>
        <div className="setup-header-actions">
          <button
            type="button"
            className="setup-quiet"
            disabled={disabled}
            onClick={restart}
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span>Start over</span>
          </button>
          {!complete && (
            <button
              type="button"
              className="setup-quiet"
              disabled={disabled}
              onClick={onExit}
            >
              Finish later
            </button>
          )}
        </div>
        <div
          className="setup-progress"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span style={{ width: `${Math.max(progress.percent, 4)}%` }} />
        </div>
      </header>
      <div
        className="setup-feed"
        ref={feed}
        role="log"
        aria-live="polite"
        aria-label="Setup conversation"
      >
        <ol>
          {history.map(({ step, value, automatic }) =>
            step.id === "review" ? null : (
              <Fragment key={step.id}>
                <AssistantMessage text={prompt(step).text} />
                <UserMessage
                  step={step}
                  value={value}
                  answers={answers}
                  automatic={automatic}
                  fresh={step.id === lastHistory}
                  onEdit={
                    step.editable === false || disabled
                      ? null
                      : () => edit(step.id)
                  }
                />
              </Fragment>
            ),
          )}
          {current && (
            <AssistantMessage {...prompt(current)} fresh>
              {current.kind === "review" && (
                <ReviewCard
                  history={history}
                  answers={answers}
                  disabled={disabled}
                  onEdit={edit}
                />
              )}
            </AssistantMessage>
          )}
          {complete && (
            <AssistantMessage
              fresh
              text={`You’re all set, ${answers.name}! Your StreamLion workspace is ready to turn client requests into completed, professional handovers.`}
              hint="Your answers stay on this device. Rerun this assistant any time from Account."
            >
              {results?.length > 0 && (
                <ul className="setup-results">
                  {results.map((item) => (
                    <li
                      key={item.text}
                      className={item.ok ? "is-ok" : "is-warn"}
                    >
                      {item.ok ? (
                        <CircleCheck size={16} aria-hidden="true" />
                      ) : (
                        <CircleAlert size={16} aria-hidden="true" />
                      )}
                      {item.text}
                    </li>
                  ))}
                </ul>
              )}
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
            This browser couldn’t save your answers. Finish setup in one go, or
            allow site storage for StreamLion.
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
        {error && !Object.keys(fieldErrors).length && (
          <p role="alert" className="setup-error">
            {error}
          </p>
        )}
        {complete ? (
          <div className="setup-dock-actions setup-finish">
            <button
              type="button"
              onClick={() => {
                setResults(null);
                commit(reopenSetup(stateRef.current));
              }}
            >
              Review answers
            </button>
            <button type="button" onClick={() => onFinish("Projects")}>
              Go to Projects
            </button>
            <button
              type="button"
              className="primary"
              data-setup-focus
              onClick={() => onFinish("new")}
            >
              Create my first project
            </button>
          </div>
        ) : (
          widget()
        )}
      </section>
    </main>
  );
}
