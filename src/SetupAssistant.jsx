import { Fragment, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  FolderPlus,
  FolderSearch,
  FolderSync,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  WifiOff,
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
  STAGES,
  answerStep,
  editStep,
  newSetup,
  newerSetup,
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
import { fetchRead } from "./network.js";
import { saveTheme } from "./theme.js";
import { rememberProviderContact } from "./provider-contact.js";
import { setupAPI } from "./setup-sync.js";
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

// Public credit-pack settings; purchases happen on the Credits page.
async function loadCreditConfig() {
  const response = await fetchRead("/api/credits/config", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || typeof data.enabled !== "boolean")
    throw new Error("Credit settings could not be checked.");
  return data;
}
const READ_ALOUD_KEY = "streamlion-read-answers-v1";
function initialSetup() {
  const saved = readSetup();
  if (!saved) return newSetup();
  return saved.status === "complete" ? reopenSetup(saved) : saved;
}
function applyPlan(profile, connected) {
  const plan = [];
  const shown = [
    profile.website && "website",
    profile.phone && "phone",
    profile.area && "service area",
    profile.welcome && "welcome line",
    profile.logo && "logo",
  ].filter(Boolean);
  const details = shown.length
    ? `, your ${shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0]}`
    : "";
  if (connected && profile.business)
    plan.push(
      `Save “${profile.business}”${details} to your client request pages`,
    );
  if (connected && profile.pricing)
    plan.push("Publish this pricing as the default for new request forms");
  if (!connected && (profile.business || profile.pricing))
    plan.push(
      "Keep your branding and pricing on this device. Connect Google later to publish them from Account",
    );
  if (profile.business)
    plan.push("Start new projects with your business name and email");
  if (profile.phone || profile.area)
    plan.push(
      "Show your phone and service area on job handovers prepared on this device",
    );
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
  loadCredits = loadCreditConfig,
  setupApi = setupAPI,
}) {
  const [state, setState] = useState(initialSetup);
  // A finished setup reopens on its review card with its answers kept.
  const reopened = useRef(readSetup()?.status === "complete");
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
    [credits, setCredits] = useState({ loading: false, value: null }),
    [accountSaved, setAccountSaved] = useState(""),
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
    reopened: reopened.current,
  };
  const walked = walk(state, ctx);
  const { answers, history, current } = walked;
  const progress = stageProgress(walked);
  const complete = !current;

  const creditStep = current?.id === "aiCredits" && live;
  useEffect(() => {
    if (!creditStep || credits.value || credits.loading) return;
    let active = true;
    setCredits({ loading: true, value: null });
    loadCredits()
      .then((value) => active && setCredits({ loading: false, value }))
      .catch(
        () =>
          active && setCredits({ loading: false, value: null, failed: true }),
      );
    return () => {
      active = false;
    };
  }, [creditStep]);
  useEffect(() => {
    scrollToLatest(feed.current);
  }, [current?.id, history.length, results]);
  useEffect(() => {
    if (!current || busy) return;
    focusAnswer(dock.current);
  }, [current?.id, editing]);

  function commit(next, { sync = true } = {}) {
    stateRef.current = next;
    setState(next);
    setStorageWarning(!writeSetup(next));
    if (sync) queueAccountSave();
  }
  // With Google connected, answers are also kept with the account so they
  // follow the provider to other devices. This device's copy always saves first.
  const accountTimer = useRef(null),
    accountSubject = useRef("");
  function queueAccountSave() {
    if (!accountSubject.current) return;
    clearTimeout(accountTimer.current);
    accountTimer.current = setTimeout(async () => {
      try {
        await setupApi(stateRef.current, accountSubject.current);
        setAccountSaved("Saved to your Google account");
      } catch {
        setAccountSaved(
          "Saved on this device; your account copy will update later",
        );
      }
    }, 600);
  }
  useEffect(() => () => clearTimeout(accountTimer.current), []);
  useEffect(() => {
    if (!live) return;
    let active = true;
    const opened = stateRef.current;
    setupApi()
      .then((remote) => {
        if (!active || !remote.available) return;
        accountSubject.current = remote.subject;
        const newest = newerSetup(stateRef.current, remote.state);
        // A newer copy from another device replaces an untouched one here.
        if (newest === remote.state && stateRef.current === opened) {
          commit(newest.status === "complete" ? reopenSetup(newest) : newest, {
            sync: false,
          });
          setAccountSaved("Restored from your Google account");
        } else if (newest !== remote.state) queueAccountSave();
        else setAccountSaved("Saved to your Google account");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [live]);
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
      if (step.id === "aiVoice")
        try {
          localStorage.setItem(READ_ALOUD_KEY, String(value === "aloud"));
        } catch {
          /* the Ask page keeps its own switch */
        }
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
          phone: profile.phone || saved.phone || "",
          area: profile.area || saved.area || "",
          welcome: profile.welcome || saved.welcome || "",
          logo: profile.logo?.logo || saved.logo || "",
          shape: profile.logo ? profile.logo.shape : saved.shape || "rounded",
        });
        await brandingApi(
          { branding, version: current.version },
          current.subject,
        );
        rememberProviderContact(branding);
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
      // Handovers prepared on this device show the phone and service area.
      rememberProviderContact(profile);
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
      case "credits": {
        const packs = credits.value?.packs || [];
        const open = live && credits.value?.enabled;
        return (
          <div className="setup-card">
            {!live ? (
              <p className="setup-status">
                Credits belong to a Google account. Connect Google first, then
                add credits any time from Account → Credits.
              </p>
            ) : credits.loading ? (
              <p role="status" className="setup-status">
                <LoaderCircle size={18} aria-hidden="true" /> Checking credit
                packs…
              </p>
            ) : credits.failed ? (
              <p className="setup-status">
                Couldn’t check credit packs right now. You can add credits any
                time from Account → Credits.
              </p>
            ) : !open ? (
              <p className="setup-status">
                Credit purchases aren’t open yet. We’ll keep your choice, and
                the free Briefing Helper works today.
              </p>
            ) : (
              <p className="setup-status">
                Packs:{" "}
                {packs
                  .map((pack) =>
                    new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: pack.amount % 100 ? 2 : 0,
                    }).format(pack.amount / 100),
                  )
                  .join(" · ")}
                . You choose a pack and pay on the next page; add more whenever
                you need them.
              </p>
            )}
            <div className="setup-dock-actions">
              <button
                type="button"
                data-setup-focus={open ? undefined : true}
                disabled={disabled}
                onClick={() => submit("later")}
              >
                {open ? "Later" : "OK, I’ll add credits later"}
              </button>
              {open && (
                <a
                  className="setup-link-button primary"
                  data-setup-focus
                  href="/api/credits"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => submit("opened")}
                >
                  Add credits now ↗
                </a>
              )}
            </div>
          </div>
        );
      }
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
      <ChatHeader
        title="Setup assistant"
        label="Setup progress"
        percent={progress.percent}
        status={
          complete
            ? "All set"
            : `Step ${progress.stage + 1} of ${STAGES.length} · ${progress.label}`
        }
      >
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
      </ChatHeader>
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
                  stages={STAGES}
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
              {answers.aiUses?.includes("helper") && (
                <p className="setup-hint">
                  Briefing Helper: create a project and choose “Prepare my brief
                  in ChatGPT”, then bring its project file back.
                </p>
              )}
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
        {accountSaved && !busy && (
          <p className="setup-saved" role="status">
            {accountSaved}
          </p>
        )}
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
