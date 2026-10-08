import { useEffect, useRef, useState } from "react";
import { creditLabel } from "./managed-ai.js";
export async function creditRequest(path, { account, ...options } = {}) {
  const response = await fetch("/api/credits/" + path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(account ? { "X-StreamLion-Account": account } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Credits could not be checked. Try again.");
  if (["config", "status"].includes(path) && typeof data.enabled !== "boolean")
    throw new Error("Credit settings could not be verified.");
  return data;
}
export default function Credits() {
  const [config, setConfig] = useState(null),
    [account, setAccount] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const epoch = useRef(0),
    submitting = useRef(false);
  async function load() {
    const generation = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const [c, a] = await Promise.allSettled([
        creditRequest("config"),
        creditRequest("status"),
      ]);
      if (generation !== epoch.current) return;
      if (a.status === "rejected") throw a.reason;
      setAccount(a.value);
      const sessionId = new URLSearchParams(window.location.search).get(
        "session_id",
      );
      // Confirm and recover a paid purchase even while new credit sales are paused.
      if (sessionId && a.value.connected) {
        const result = await creditRequest("confirm", {
          method: "POST",
          account: a.value.subject,
          body: JSON.stringify({ sessionId }),
        });
        if (generation !== epoch.current) return;
        setMessage(
          result.status === "paid"
            ? "Your credits are ready."
            : ["refunded", "disputed", "failed", "expired"].includes(
                  result.status,
                )
              ? "This payment has no active credits. Contact support if you need help."
              : "Payment is still being confirmed. Check again shortly; no new payment is needed.",
        );
        const current = await creditRequest("status");
        if (generation !== epoch.current) return;
        setAccount(current);
        if (result.status === "paid")
          window.history.replaceState(null, "", window.location.pathname);
      }
      if (c.status === "rejected") throw c.reason;
      setConfig(c.value);
    } catch (e) {
      if (generation === epoch.current) {
        setConfig(null);
        setError(e.message);
      }
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("cancelled"))
      setMessage("Checkout cancelled. Your existing credits are unchanged.");
    load();
    return () => {
      epoch.current++;
    };
  }, []);
  async function buy(packId) {
    if (submitting.current || busy || !account?.connected) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await creditRequest("checkout", {
        method: "POST",
        account: account.subject,
        body: JSON.stringify({ packId }),
      });
      if (result.licenseRequired)
        setError(
          "Purchase StreamLion with this Google account before adding credits.",
        );
      else if (result.pendingAmount)
        setMessage(
          `You already have a pending $${(result.pendingAmount / 100).toFixed(2)} top-up. Choose that pack to continue it, or wait for its checkout to expire before changing packs.`,
        );
      else if (result.processing)
        setMessage("Payment is being confirmed. Check again shortly.");
      else if (result.credited) {
        setMessage("Your last credit payment is ready.");
        await load();
      } else if (
        result.url &&
        new URL(result.url).origin === "https://checkout.stripe.com"
      )
        window.location.assign(result.url);
      else throw new Error("Checkout is unavailable. Try again.");
    } catch (e) {
      setError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="purchase-card" aria-labelledby="credits-title">
      <a className="purchase-brand" href="/api/welcome">
        <img src="/lion-mint.png" alt="" width="36" height="36" />
        StreamLion
      </a>
      <h1 id="credits-title">Credits for client work and AI</h1>
      <p>
        One prepaid wallet for confirmed client jobs and the optional AI Project
        Assistant. Add credits when you need them. No subscription or automatic
        recharge.
      </p>
      {(config?.mode || account?.mode) === "test" && (
        <p className="purchase-test" role="note">
          Stripe test checkout. Test credits have no monetary value and cannot
          pay for live jobs or AI answers.
        </p>
      )}
      {account?.connected && (
        <>
          <p>
            Credits for <strong>{account.account}</strong>
          </p>
          <p className="credit-balance">
            {creditLabel(account.balanceMicros)} available
          </p>
          {account.creditHold && (
            <p role="alert">
              A refunded or disputed payment affects this balance. Contact
              support to resolve it.
            </p>
          )}
          <a href="/api/google/start?returnTo=credits">
            Use a different Google account
          </a>
        </>
      )}
      {!config && !error && <p role="status">Checking credit options…</p>}
      {config?.enabled === false && (
        <p>
          Credit purchases are not open yet. Your saved-detail voice lookup
          remains included in StreamLion.
        </p>
      )}
      {config?.enabled &&
        (!account?.connected ? (
          <a
            className="purchase-primary"
            href="/api/google/start?returnTo=credits"
          >
            Continue with Google
          </a>
        ) : !account.purchased ? (
          <p>
            <a className="purchase-primary" href="/api/purchase">
              Purchase or restore StreamLion first
            </a>
          </p>
        ) : (
          <div className="credit-packs" aria-label="Prepaid credit packs">
            {config.packs.map((pack) => (
              <button
                key={pack.id}
                aria-label={`${creditLabel(pack.creditsMicros)} for ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(pack.amount / 100)}`}
                onClick={() => buy(pack.id)}
                disabled={busy}
              >
                <strong>{creditLabel(pack.creditsMicros)}</strong>
                <span>
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                  }).format(pack.amount / 100)}
                </span>
              </button>
            ))}
          </div>
        ))}
      {config?.enabled && (
        <p>
          Purchased credits stay with this Google account across devices and do
          not expire. Credits are separate from your one-time app purchase.
          Promotional starter credits follow the eligibility shown in client
          requests.
        </p>
      )}
      <section aria-labelledby="credit-uses-title">
        <h2 id="credit-uses-title">What uses credits?</h2>
        <p>
          When client coordination is available, creating a request uses no
          project credits. The provider sees and authorizes the job charge
          before agreement. That charge applies once, after both sides approve
          the current brief. Clients use their invited portal free. Reopening or
          recovering the same job does not add a second job charge.{" "}
          <a href="/api/client-requests">Open client requests</a>.
        </p>
        <p>
          Optional AI answers show their credit charge before you ask.
          Incomplete text answers return reserved credits; a completed text
          answer uses the quoted credits even if spoken playback is unavailable.
          Saved-detail lookup remains included in Core.
        </p>
      </section>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={load}>
        {busy ? "Checking…" : "Refresh balance and payment status"}
      </button>
      <p>
        <a href="/">Return to workspace</a>
      </p>
      <footer>
        <a href="/api/terms#ai-credits">Credit terms</a> ·{" "}
        <a href="/api/privacy">Privacy</a> ·{" "}
        <a href="mailto:info@transcendencemedia.com">Support</a>
      </footer>
    </section>
  );
}
