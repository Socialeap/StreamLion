import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Users,
  Activity,
  Coins,
  ShieldCheck,
  Search,
  ArrowUpRight,
  RefreshCw,
  X,
  ChevronRight,
  LockKeyhole,
} from "lucide-react";
const number = (v) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 }).format(
    Number(v) || 0,
  );
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "America/New_York",
      }).format(new Date(v))
    : "Not recorded";
const statusName = (v) =>
  ({
    paid: "Paid Core",
    registered: "Registered",
    pilot_active: "Active pilot",
    pilot_expired: "Pilot ended",
    refunded: "Refunded",
    disputed: "Disputed",
    credit_hold: "Credit hold",
  })[v] || v.replaceAll("_", " ");
const signIn = "/api/google/start?returnTo=%2Fadmin%2F";
const pendingKey = "streamlion:admin:pending-operation:v1";
function readPending() {
  try {
    const p = JSON.parse(window.sessionStorage.getItem(pendingKey) || "null");
    return p &&
      /^[a-f0-9-]{36}$/i.test(p.id) &&
      ["test", "live"].includes(p.mode)
      ? p
      : null;
  } catch {
    return null;
  }
}
function savePending(op, mode) {
  const value = JSON.stringify({ id: op.operationId, mode });
  window.sessionStorage.setItem(pendingKey, value);
  if (window.sessionStorage.getItem(pendingKey) !== value)
    throw Error("Recovery storage unavailable");
}
function Identity({ user }) {
  return (
    <>
      <strong>{user.name || user.business || "Name not provided"}</strong>
      <span>{user.email || "Email not recorded"}</span>
      {user.name && user.business ? <small>{user.business}</small> : null}
    </>
  );
}
function Trend({ rows, kind }) {
  const spend = kind === "credits",
    key = kind === "known" ? "known" : "active",
    max = Math.max(
      1,
      ...rows.map((r) =>
        spend ? r.ai + r.coordination + r.speech : r[key] || 0,
      ),
    );
  return (
    <div className="admin-chart">
      <div
        className="admin-bars"
        role="img"
        aria-label={
          spend
            ? "Daily completed credits by request date"
            : key === "known"
              ? "Newly observed accounts each day"
              : "Daily active accounts"
        }
      >
        {rows.map((r) => (
          <div
            className="admin-bar-slot"
            key={r.day}
            title={`${r.day}: ${spend ? number(r.ai + r.coordination + r.speech) + " credits" : (r[key] || 0) + (key === "known" ? " newly observed accounts" : " active accounts")}`}
          >
            <div
              className="admin-bar"
              style={{
                height: `${(100 * (spend ? r.ai + r.coordination + r.speech : r[key] || 0)) / max}%`,
              }}
            >
              {spend ? (
                <>
                  <i className="admin-segment ai" style={{ flex: r.ai }} />
                  <i
                    className="admin-segment coordination"
                    style={{ flex: r.coordination }}
                  />
                  <i
                    className="admin-segment speech"
                    style={{ flex: r.speech }}
                  />
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="admin-axis">
        <span>{rows[0]?.day}</span>
        <span>{rows.at(-1)?.day}</span>
      </div>
      <details>
        <summary>Show daily values</summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>
                {spend
                  ? "AI / coordination / speech credits"
                  : key === "known"
                    ? "Newly observed accounts"
                    : "Active accounts"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{r.day}</td>
                <td>
                  {spend
                    ? `${number(r.ai)} / ${number(r.coordination)} / ${number(r.speech)}`
                    : r[key] || 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
function AccountDrawer({
  detail,
  session,
  onClose,
  onReview,
  receipt,
  mutationBusy,
  covered,
  changesLocked,
}) {
  const dialog = useRef(null);
  useEffect(() => {
    if (covered) return;
    const node = dialog.current;
    const prior = document.activeElement;
    node?.focus();
    function key(e) {
      if (e.key === "Escape" && !mutationBusy) onClose();
      if (e.key === "Tab") {
        const els = [
          ...node.querySelectorAll("button,a,input,select,textarea"),
        ].filter((e) => !e.disabled);
        if (!els.length) return;
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0].focus();
        }
      }
    }
    node?.addEventListener("keydown", key);
    return () => {
      node?.removeEventListener("keydown", key);
      prior?.focus?.();
    };
  }, [onClose, mutationBusy, covered]);
  const u = detail.user;
  return (
    <div className="admin-overlay">
      <section
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Account details for ${u.email}`}
        aria-hidden={covered || undefined}
        inert={covered || undefined}
        className="admin-drawer"
      >
        <header>
          <div>
            <p className="admin-eyebrow">ACCOUNT DETAILS</p>
            <h2>{u.name || u.business || "Account"}</h2>
            <p>{u.email}</p>
          </div>
          <button
            aria-label="Close account"
            onClick={onClose}
            disabled={mutationBusy}
          >
            <X size={20} />
          </button>
        </header>
        <span className={`admin-status ${u.status}`}>
          {statusName(u.status)}
        </span>
        <div className="admin-wallet-grid">
          {[
            ["Purchased", u.wallet.purchased],
            ["Starter", u.wallet.starter],
            ["Admin goodwill", u.wallet.goodwill],
            ["Available", u.wallet.available],
          ].map(([label, n]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{number(n)}</strong>
              <span>credits</span>
            </div>
          ))}
        </div>
        {u.wallet.goodwill > 0 && !u.canGrant ? (
          <p className="admin-notice">
            Retained goodwill is unavailable until the account meets its
            existing access requirements.
          </p>
        ) : null}
        <dl className="admin-facts">
          <div>
            <dt>First known</dt>
            <dd>{date(u.firstKnownAt)}</dd>
          </div>
          <div>
            <dt>First recorded sign-in</dt>
            <dd>{date(u.signupAt)}</dd>
          </div>
          <div>
            <dt>
              {u.paidAt
                ? "First payment confirmation"
                : "First Core order (payment date unknown)"}
            </dt>
            <dd>{date(u.paidAt || u.orderCreatedAt)}</dd>
          </div>
          <div>
            <dt>Last observed activity</dt>
            <dd>{date(u.lastActiveAt)}</dd>
          </div>
          <div>
            <dt>Active days (7 / 30)</dt>
            <dd>
              {u.active7} / {u.active30}
            </dd>
          </div>
          <div>
            <dt>Reserved credits</dt>
            <dd>{number(u.reservedCredits)}</dd>
          </div>
        </dl>
        <button
          className="admin-primary"
          onClick={() =>
            onReview({
              type: "grant",
              target: u.subject,
              credits:
                detail.allowance.perAccountMonth - u.grantedThisMonth >= 240 &&
                detail.allowance.remaining >= 240
                  ? 240
                  : "",
              reason: "",
            })
          }
          disabled={
            !u.canGrant ||
            !session.canAuthorize ||
            changesLocked ||
            !detail.allowance.grantsEnabled
          }
        >
          Add free credits
        </button>
        {!session.canAuthorize ? (
          <p className="admin-notice">
            Credit changes need verifiable recent owner authentication.{" "}
            <a href={signIn}>Verify owner sign-in</a>
          </p>
        ) : null}
        <p className="admin-subtle">
          800 per grant and account/month · {number(detail.allowance.remaining)}{" "}
          of 4,000 monthly credits remaining. Grants do not activate access.
        </p>
        {receipt ? (
          <div className="admin-receipt" role="status">
            <strong>Credit change recorded</strong>
            <p>
              {number(receipt.amountCredits)} credits · goodwill balance after
              change: {number(receipt.balanceAfter)}
            </p>
            <code>{receipt.id}</code>
            <small>
              The balance is a receipt snapshot; current balances may change
              with use.
            </small>
          </div>
        ) : null}
        {detail.unreconciledLegacyAI?.count ? (
          <p className="admin-notice">
            {detail.unreconciledLegacyAI.count} older AI charges (
            {number(detail.unreconciledLegacyAI.credits)} credits) need
            historical reconciliation and are excluded from consumption totals.
          </p>
        ) : null}
        <h3>Complimentary grants</h3>
        {!detail.grants.length ? (
          <p className="admin-subtle">No admin grants recorded.</p>
        ) : (
          detail.grants.map((g) => (
            <article className="admin-history" key={g.id}>
              <div>
                <strong>{number(g.amount_micros / 12500)} credits</strong>
                <span>
                  {date(g.created_at)} · {g.reason}
                </span>
                <small>
                  {number(g.remaining_micros / 12500)} unused ·{" "}
                  {number(g.reserved_micros / 12500)} reserved ·{" "}
                  {number(g.consumed_micros / 12500)} consumed ·{" "}
                  {number(g.reversed_micros / 12500)} reversed
                </small>
              </div>
              <button
                disabled={
                  !session.canAuthorize ||
                  changesLocked ||
                  !detail.allowance.grantsEnabled ||
                  g.remaining_micros <= 0
                }
                onClick={() =>
                  onReview({
                    type: "reversal",
                    target: g.id,
                    credits: g.remaining_micros / 12500,
                    reason: "",
                  })
                }
              >
                Reverse unused credits
              </button>
            </article>
          ))
        )}
        <h3>Purchase history</h3>
        {detail.purchases.length ? (
          detail.purchases.map((p) => (
            <article className="admin-history" key={p.id}>
              <div>
                <strong>
                  {p.kind === "core" ? "Core purchase" : "Credit purchase"} ·{" "}
                  {statusName(p.status)}
                </strong>
                <span>
                  {date(p.created_at)} · USD {(p.amount / 100).toFixed(2)} paid
                  · USD {(p.amount_refunded / 100).toFixed(2)} refunded
                </span>
                <small>
                  Order creation date; payment records do not establish bank
                  settlement.
                </small>
              </div>
            </article>
          ))
        ) : (
          <p className="admin-subtle">No purchases recorded.</p>
        )}
        <h3>Credit audit</h3>
        {detail.audit.length ? (
          detail.audit.map((a) => (
            <article className="admin-history" key={a.id}>
              <div>
                <strong>
                  {a.action.replaceAll("_", " ")} ·{" "}
                  {number(a.amount_micros / 12500)} credits
                </strong>
                <span>
                  {date(a.created_at)} · {a.reason}
                </span>
                <code>{a.id}</code>
              </div>
            </article>
          ))
        ) : (
          <p className="admin-subtle">No credit changes recorded.</p>
        )}
        <p className="admin-subtle">
          Latest 50 records per history. Complete audit records remain on the
          server.
        </p>
      </section>
    </div>
  );
}
export default function AdminPortal() {
  const [session, setSession] = useState(null),
    [overview, setOverview] = useState(null),
    [page, setPage] = useState(null),
    [detail, setDetail] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("recent"),
    [days, setDays] = useState(30),
    [cursor, setCursor] = useState(""),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("overview"),
    [form, setForm] = useState(null),
    [review, setReview] = useState(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [receipt, setReceipt] = useState(null),
    [history, setHistory] = useState(null),
    [historyCursor, setHistoryCursor] = useState(""),
    [unresolved, setUnresolved] = useState(() => Boolean(readPending()));
  const idleDeadline = useRef(0),
    absoluteDeadline = useRef(0),
    loadSequence = useRef(0);
  const confirmRef = useRef(null);
  const generation = useRef(0),
    subject = useRef(""),
    inFlight = useRef(false),
    selection = useRef(0);
  function clear() {
    generation.current++;
    subject.current = "";
    setSession(null);
    setOverview(null);
    setPage(null);
    setDetail(null);
    setForm(null);
    setReview(null);
    setReceipt(null);
    setHistory(null);
    setLoading(false);
    setUnresolved(Boolean(readPending()));
  }
  function forgetPending() {
    window.sessionStorage.removeItem(pendingKey);
    setUnresolved(false);
  }
  async function reconcilePending(s = session) {
    const p = readPending();
    if (!p) {
      setUnresolved(false);
      return;
    }
    setUnresolved(true);
    if (p.mode !== s.mode) {
      setError(
        "An unresolved credit change belongs to another payment mode. Reopen that mode to reconcile it before creating another.",
      );
      return;
    }
    const result = await request("operations/" + p.id);
    if (result.state === "complete") {
      forgetPending();
      setUncertain(false);
      setReview(null);
      setForm(null);
      setReceipt(result.receipt);
      try {
        setDetail(
          await request(
            "users/" +
              encodeURIComponent(result.receipt.target) +
              "?days=" +
              days,
          ),
        );
      } catch {
        /* The durable receipt remains visible even when metadata is unavailable. */
      }
    } else if (result.state === "not_committed") {
      forgetPending();
      setUncertain(false);
      setError(
        "The previous change was not committed. You may review a new change.",
      );
    } else {
      setUncertain(true);
      setError(
        "A credit change is unresolved. Check its status or retry the same operation; new changes are locked.",
      );
    }
  }
  async function request(path, body) {
    const version = generation.current,
      started = Date.now();
    const r = await fetch("/api/admin/" + path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        "X-StreamLion-Account": subject.current,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const v = await r.json();
    if (version !== generation.current)
      throw Error("Account changed. Sign in again.");
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        clear();
      }
      const e = Error(v.error || "Admin request unavailable.");
      e.status = r.status;
      throw e;
    }
    if (path !== "session" && absoluteDeadline.current)
      idleDeadline.current = Math.min(
        absoluteDeadline.current,
        started + 900000,
      );
    return v;
  }
  async function initialize() {
    setLoading(true);
    setError("");
    try {
      const started = Date.now();
      const s = await request("session");
      if (!s.authorized || s.locked) {
        clear();
        setError("Sign in to open a fresh owner session.");
        return;
      }
      subject.current = s.subject;
      const received = Date.now(),
        elapsed = received - started;
      idleDeadline.current =
        received + Math.max(0, (s.idleExpiresInMs ?? 900000) - elapsed);
      absoluteDeadline.current =
        received + Math.max(0, (s.absoluteExpiresInMs ?? 3600000) - elapsed);
      setSession(s);
      if (readPending()) await reconcilePending(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void initialize();
    return () => {
      generation.current++;
    };
  }, []);
  async function load() {
    if (!session) return;
    const version = generation.current,
      sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        days: String(days),
        search: query,
        filter,
        sort,
        ...(cursor ? { cursor } : {}),
      });
      const [o, p] = await Promise.all([
        request("overview?days=" + days),
        request("users?" + params),
      ]);
      if (version === generation.current && sequence === loadSequence.current) {
        setOverview(o);
        setPage(p);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      if (version === generation.current && sequence === loadSequence.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [session, days, query, filter, sort, cursor]);
  useEffect(() => {
    if (!session) return;
    const check = () => {
      if (document.visibilityState === "visible" && !inFlight.current) {
        setOverview(null);
        setPage(null);
        if (!readPending()) {
          setDetail(null);
          setForm(null);
          setReview(null);
        }
        void initialize();
      }
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      const time = Date.now();
      if (time >= idleDeadline.current || time >= absoluteDeadline.current) {
        clear();
        setError("Admin session expired. Sign in again.");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [session]);
  async function open(user) {
    const id = ++selection.current;
    setReceipt(null);
    setError("");
    try {
      const d = await request(
        "users/" + encodeURIComponent(user.subject) + "?days=" + days,
      );
      if (id === selection.current) setDetail(d);
    } catch (e) {
      setError(e.message);
    }
  }
  const close = useCallback(() => {
    selection.current++;
    setDetail(null);
    setForm(null);
    setReview(null);
    setReceipt(null);
  }, []);
  async function submit() {
    if (inFlight.current || !review) return;
    const prior = readPending();
    if (
      prior &&
      (prior.id !== review.operationId || prior.mode !== session.mode)
    ) {
      setError("Resolve the previous credit change before submitting another.");
      return;
    }
    try {
      savePending(review, session.mode);
    } catch {
      setError(
        "Browser recovery storage is unavailable. No credit change was submitted.",
      );
      return;
    }
    setUnresolved(true);
    inFlight.current = true;
    let committed = false;
    setBusy(true);
    setError("");
    try {
      const a = await request("authorize", review);
      const r = a.id
        ? a
        : await request(review.type === "grant" ? "grants" : "reversals", {
            ...review,
            authorization: a.authorization,
          });
      setReceipt(r);
      committed = true;
      forgetPending();
      setForm(null);
      setReview(null);
      setUncertain(false);
      if (detail) {
        const d = await request(
          "users/" + encodeURIComponent(detail.user.subject) + "?days=" + days,
        );
        setDetail(d);
      }
      await load();
    } catch (e) {
      if (committed) {
        setUncertain(false);
        setError(
          "The credit change was recorded, but refreshed data is unavailable. Inspect the receipt or audit.",
        );
        return;
      }
      if (e.status && ![401, 403].includes(e.status) && e.status < 500)
        forgetPending();
      setUncertain(
        !e.status || e.status >= 500 || e.status === 401 || e.status === 403,
      );
      setError(
        e.message +
          (!e.status || e.status >= 500
            ? " The result is uncertain. Retry this same change or inspect the audit before creating another."
            : ""),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!form) return;
    const node = confirmRef.current,
      prior = document.activeElement;
    node?.querySelector("input,button")?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !busy && !uncertain) {
        setForm(null);
        setReview(null);
      }
      if (e.key === "Tab") {
        const els = [...node.querySelectorAll("button,input,textarea")].filter(
          (e) => !e.disabled,
        );
        if (!els.length) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    node?.addEventListener("keydown", key);
    return () => {
      node?.removeEventListener("keydown", key);
      prior?.focus?.();
    };
  }, [Boolean(form), Boolean(review), busy, uncertain]);
  useEffect(() => {
    if (!session || tab !== "credits") return;
    let live = true;
    request(
      "activity" +
        (historyCursor ? "?cursor=" + encodeURIComponent(historyCursor) : ""),
    )
      .then((v) => {
        if (live) setHistory(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [session, tab, historyCursor, receipt]);
  async function signOut() {
    if (inFlight.current) return;
    try {
      await request("close", {});
      await fetch("/api/google/signout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-StreamLion-Account": subject.current },
      });
    } catch {
    } finally {
      clear();
      setError("Signed out of the admin portal.");
    }
  }
  if (!session)
    return (
      <main className="admin-login">
        <div className="admin-login-mark">
          <ShieldCheck size={34} />
        </div>
        <p className="admin-eyebrow">STREAMLION · OWNER ACCESS</p>
        <h1>Your operation, in view.</h1>
        <p>
          Account activity, credit balances, and individual goodwill grants.
        </p>
        {error ? (
          <p role="alert" className="admin-notice">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p>Checking owner access…</p>
        ) : (
          <a className="admin-primary" href={signIn}>
            Sign in with Google
          </a>
        )}
        <small>Restricted to the enrolled owner Google account.</small>
      </main>
    );
  return (
    <main className="admin-app">
      {session.preview ? (
        <div className="admin-preview-label">
          SYNTHETIC PREVIEW · No live accounts, payments, grants or provider
          calls
        </div>
      ) : null}
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/admin/">
          <span>SL</span>StreamLion<small>ADMIN</small>
        </a>
        <nav aria-label="Admin views">
          {[
            ["overview", Activity, "Overview"],
            ["users", Users, "Users"],
            ["credits", Coins, "Credit activity"],
          ].map(([key, Icon, label]) => (
            <button
              className={tab === key ? "selected" : ""}
              key={key}
              onClick={() => setTab(key)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <ShieldCheck size={18} />
          <span>Owner-only workspace</span>
          <small>Customer project content stays in Google.</small>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-top">
          <div>
            <p className="admin-eyebrow">STREAMLION ADMIN</p>
            <h1>
              {tab === "overview"
                ? "A clear view of your users."
                : tab === "users"
                  ? "Every account, in one place."
                  : "Credits with a clear record."}
            </h1>
            <p>Usage, purchases, and goodwill—without losing the details.</p>
          </div>
          <div className="admin-owner">
            <span className={"admin-mode " + session.mode}>
              {session.mode.toUpperCase()}
            </span>
            <small>{session.account}</small>
            <button onClick={signOut} disabled={busy}>
              <LockKeyhole size={15} />
              Sign out
            </button>
          </div>
        </header>
        <nav className="admin-mobile-nav" aria-label="Admin views on phone">
          {[
            ["overview", "Overview"],
            ["users", "Users"],
            ["credits", "Credit activity"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "selected" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        {unresolved ? (
          <div className="admin-notice" role="status">
            A credit change needs reconciliation. New changes are locked.{" "}
            <button
              disabled={busy}
              onClick={() =>
                reconcilePending().catch((e) => setError(e.message))
              }
            >
              Check pending change
            </button>
          </div>
        ) : null}
        {receipt && !detail ? (
          <div className="admin-receipt" role="status">
            <strong>Credit change recorded</strong>
            <p>
              {number(receipt.amountCredits)} credits · {receipt.id}
            </p>
          </div>
        ) : null}
        <div className="admin-toolbar">
          <span className="admin-timezone">
            America/New_York ·{" "}
            {overview
              ? "Updated " +
                new Date(overview.asOf).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/New_York",
                })
              : "Checking data"}
          </span>
          <label>
            Report period
            <select
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setCursor("");
              }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <button onClick={load} disabled={loading}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        {error ? (
          <p role="alert" className="admin-notice">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="admin-subtle">
            Refreshing account data…
          </p>
        ) : null}
        {overview && tab === "overview" ? (
          <>
            <section className="admin-kpis" aria-label="Account overview">
              {[
                ["Known accounts", overview.registered, Users],
                ["Paid Core accounts", overview.paid, ShieldCheck],
                [
                  "Active · 7 / 30 days",
                  `${overview.active7} / ${overview.active30}`,
                  Activity,
                ],
                ["Credits consumed", number(overview.creditsUsed), Coins],
              ].map(([label, v, Icon]) => (
                <article key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon size={20} />
                  </div>
                  <strong>{v}</strong>
                  <small>
                    {label === "Credits consumed"
                      ? `Completed charges · ${days} days`
                      : "Excludes owner and test-mode accounts"}
                  </small>
                </article>
              ))}
            </section>
            <section className="admin-charts">
              <article className="admin-panel">
                <header>
                  <div>
                    <h2>Users showing up</h2>
                    <p>Unique active accounts each day</p>
                  </div>
                  <Activity size={19} />
                </header>
                <Trend rows={overview.trend} kind="activity" />
              </article>
              <article className="admin-panel">
                <header>
                  <div>
                    <h2>Credits doing work</h2>
                    <p>Completed charges by original request date</p>
                  </div>
                  <Coins size={19} />
                </header>
                <div className="admin-legend">
                  <span className="ai">AI</span>
                  <span className="coordination">Coordination</span>
                  <span className="speech">Speech</span>
                </div>
                <Trend rows={overview.trend} kind="credits" />
              </article>
              <article className="admin-panel">
                <header>
                  <div>
                    <h2>Newly observed accounts</h2>
                    <p>
                      First-known dates; historical signups may be unavailable
                    </p>
                  </div>
                  <Users size={19} />
                </header>
                <Trend rows={overview.trend} kind="known" />
              </article>
            </section>
          </>
        ) : null}
        {overview ? (
          <section className="admin-budget">
            <div>
              <p className="admin-eyebrow">MONTHLY GOODWILL</p>
              <strong>
                {number(overview.allowance.remaining)}{" "}
                <span>/ 4,000 credits remaining</span>
              </strong>
              <p>
                800 per grant and user/month · {overview.allowance.month} ·
                Unused issuance allowance does not roll over.
              </p>
            </div>
            <progress
              value={4000 - overview.allowance.remaining}
              max={4000}
              aria-label="Monthly goodwill issued"
            />
            <span>
              {overview.allowance.grantsEnabled
                ? "Individual grants available"
                : "Credit changes paused"}
            </span>
          </section>
        ) : null}
        {tab === "credits" && history ? (
          <section className="admin-panel admin-credit-log">
            <header>
              <div>
                <h2>Recent credit changes</h2>
                <p>
                  Immutable grants, reversals and starter revocations ·{" "}
                  {session.mode} mode
                </p>
              </div>
            </header>
            <div className="admin-log-list">
              {history.entries?.length ? (
                history.entries.map((a) => (
                  <article className="admin-history" key={a.id}>
                    <div>
                      <strong>
                        {a.email || "Account"} ·{" "}
                        {number(a.amount_micros / 12500)} credits
                      </strong>
                      <span>
                        {a.action.replaceAll("_", " ")} · {date(a.created_at)} ·{" "}
                        {a.reason}
                      </span>
                      <code>{a.id}</code>
                    </div>
                    <button onClick={() => open({ subject: a.target })}>
                      View account
                    </button>
                  </article>
                ))
              ) : (
                <p className="admin-subtle">No credit changes recorded.</p>
              )}
              <div className="admin-pagination">
                <span>Up to 50 entries per page</span>
                <div>
                  {historyCursor ? (
                    <button onClick={() => setHistoryCursor("")}>
                      First page
                    </button>
                  ) : null}
                  <button
                    disabled={!history.nextCursor}
                    onClick={() => setHistoryCursor(history.nextCursor)}
                  >
                    Next changes
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}
        {page ? (
          <section className="admin-panel admin-directory">
            <header>
              <div>
                <h2>
                  {tab === "credits"
                    ? "Find an account’s credit history"
                    : "Your users"}
                </h2>
                <p>
                  {page.total} matching accounts · balances are current;
                  consumption follows the selected period
                </p>
              </div>
            </header>
            <form
              className="admin-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search);
                setCursor("");
              }}
            >
              <label className="admin-search">
                <Search size={18} />
                <input
                  aria-label="Search name or email"
                  placeholder="Search name or email prefix"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  maxLength={120}
                />
              </label>
              <button type="submit">Search</button>
              <label>
                Status
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setCursor("");
                  }}
                >
                  <option value="all">All accounts</option>
                  <option value="paid">Paid Core</option>
                  <option value="pilot">Active pilot</option>
                  <option value="active">Active in 30 days</option>
                  <option value="inactive">Inactive / unobserved</option>
                  <option value="low">Below 240 credits</option>
                </select>
              </label>
              <label>
                Sort
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setCursor("");
                  }}
                >
                  <option value="recent">Recently active first</option>
                  <option value="oldest">Least recently active first</option>
                </select>
              </label>
            </form>
            {!page.users.length ? (
              <p className="admin-empty">No accounts match these filters.</p>
            ) : (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-users-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Status</th>
                        <th>First known / purchase</th>
                        <th>Activity</th>
                        <th>Bought / granted</th>
                        <th>Used · {days}d</th>
                        <th>Available</th>
                        <th>
                          <span className="admin-sr">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.users.map((u) => (
                        <tr key={u.subject}>
                          <td className="admin-identity">
                            <Identity user={u} />
                          </td>
                          <td>
                            <span className={`admin-status ${u.status}`}>
                              {statusName(u.status)}
                            </span>
                          </td>
                          <td>
                            <span>{date(u.firstKnownAt)}</span>
                            <small>
                              {u.paidAt
                                ? "Confirmed " + date(u.paidAt)
                                : u.orderCreatedAt
                                  ? "Order " + date(u.orderCreatedAt)
                                  : "No Core order"}
                            </small>
                          </td>
                          <td>
                            <span>{u.active7} / 7 active days</span>
                            <progress
                              value={u.active7}
                              max={7}
                              aria-label={`${u.active7} active days out of 7`}
                            />
                            <small>Last: {date(u.lastActiveAt)}</small>
                          </td>
                          <td>
                            <span>
                              {number(u.netPurchasedCredits)} bought, net
                            </span>
                            <small>
                              {number(u.grantedCredits)} admin granted
                            </small>
                          </td>
                          <td>
                            <strong>{number(u.creditsUsed)}</strong>
                            <small>{number(u.reservedCredits)} reserved</small>
                          </td>
                          <td>
                            <strong>{number(u.wallet.available)}</strong>
                            <small>
                              {number(u.wallet.goodwill)} goodwill
                              {u.wallet.hold ? " · held" : ""}
                            </small>
                          </td>
                          <td>
                            <button
                              aria-label={`View ${u.name || u.business || u.email}`}
                              className="admin-row-action"
                              onClick={() => open(u)}
                            >
                              <ArrowUpRight size={19} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="admin-account-cards">
                  {page.users.map((u) => (
                    <article key={u.subject}>
                      <div className="admin-identity">
                        <Identity user={u} />
                      </div>
                      <span className={`admin-status ${u.status}`}>
                        {statusName(u.status)}
                      </span>
                      <dl>
                        <div>
                          <dt>Available credits</dt>
                          <dd>{number(u.wallet.available)}</dd>
                        </div>
                        <div>
                          <dt>Last active</dt>
                          <dd>{date(u.lastActiveAt)}</dd>
                        </div>
                        <div>
                          <dt>Active days · 7 / 30</dt>
                          <dd>
                            {u.active7} / {u.active30}
                          </dd>
                        </div>
                      </dl>
                      <button
                        aria-label={`View ${u.name || u.business || u.email}`}
                        onClick={() => open(u)}
                      >
                        View account
                        <ChevronRight size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
            <footer className="admin-pagination">
              <span>Up to 25 accounts per page</span>
              <div>
                {cursor ? (
                  <button onClick={() => setCursor("")}>First page</button>
                ) : null}
                <button
                  disabled={!page.nextCursor || loading}
                  onClick={() => setCursor(page.nextCursor)}
                >
                  Next page
                  <ChevronRight size={15} />
                </button>
              </div>
            </footer>
          </section>
        ) : null}
        {overview ? (
          <p className="admin-coverage">
            {overview.coverage}
            {overview.partial
              ? " Partial coverage: the 5,000-charge reporting limit was reached. Review narrower periods before relying on totals."
              : ""}{" "}
            Balances are credits, not provider costs or bank settlement.
          </p>
        ) : null}
      </div>
      {detail ? (
        <AccountDrawer
          detail={detail}
          session={session}
          onClose={close}
          onReview={(v) => {
            if (unresolved) {
              setError("Resolve the pending credit change first.");
              return;
            }
            setForm(v);
            setReview(null);
            setReceipt(null);
            setUncertain(false);
          }}
          receipt={receipt}
          mutationBusy={busy}
          covered={Boolean(form)}
          changesLocked={unresolved}
        />
      ) : null}
      {form && detail ? (
        <div className="admin-overlay admin-confirm-overlay">
          <section
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            aria-label="Credit change"
            className="admin-confirm"
          >
            <p className="admin-eyebrow">
              {form.type === "grant"
                ? "INDIVIDUAL GOODWILL"
                : "CORRECT UNUSED CREDITS"}
            </p>
            <h2>
              {form.type === "grant"
                ? "Add free credits"
                : "Reverse unused credits"}
            </h2>
            <p>{detail.user.email}</p>
            {review ? (
              <>
                <p className="admin-confirm-summary">
                  {review.type === "grant" ? "Grant" : "Reverse"}{" "}
                  {number(review.credits)} credits{" "}
                  {review.type === "grant" ? "to" : "for"} {detail.user.email}
                </p>
                <p>Reason: {review.reason}</p>
                <p className="admin-subtle">
                  {review.type === "grant"
                    ? "Goodwill survives Core refunds but never activates access."
                    : "Only the unused, unreserved portion of this specific grant can be reversed."}
                </p>
                {error ? (
                  <p role="alert" className="admin-notice">
                    {error}
                  </p>
                ) : null}
                <button
                  className="admin-primary"
                  onClick={submit}
                  disabled={busy}
                >
                  {busy
                    ? "Recording…"
                    : uncertain
                      ? "Check or retry this change"
                      : review.type === "grant"
                        ? "Confirm grant"
                        : "Confirm reversal"}
                </button>
                <button
                  disabled={busy || uncertain}
                  onClick={() => setReview(null)}
                >
                  Edit before confirming
                </button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.reason.trim()) return;
                  setReview({
                    ...form,
                    credits: Number(form.credits),
                    reason: form.reason.trim(),
                    operationId: crypto.randomUUID(),
                  });
                }}
              >
                <label>
                  Credits
                  <input
                    required
                    type="number"
                    min={form.type === "grant" ? 1 : 0.00008}
                    max={
                      form.type === "grant"
                        ? Math.min(
                            800,
                            detail.allowance.remaining,
                            800 - detail.user.grantedThisMonth,
                          )
                        : 800
                    }
                    step={form.type === "grant" ? 1 : 0.00008}
                    value={form.credits}
                    onChange={(e) =>
                      setForm({ ...form, credits: e.target.value })
                    }
                  />
                </label>
                <label>
                  Reason
                  <textarea
                    required
                    maxLength={500}
                    value={form.reason}
                    onChange={(e) =>
                      setForm({ ...form, reason: e.target.value })
                    }
                  />
                </label>
                <p className="admin-subtle">
                  {number(overview?.allowance.remaining)} global monthly credits
                  remain. Speech uses admin goodwill before purchased credits;
                  starter rules stay unchanged.
                </p>
                <button type="submit" className="admin-primary">
                  Review change
                </button>
              </form>
            )}
            {!busy && !uncertain ? (
              <button
                onClick={() => {
                  setForm(null);
                  setReview(null);
                }}
              >
                Cancel
              </button>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
