import { useEffect, useRef, useState } from "react";
import { purchaseRequest } from "./purchase-api.js";
export default function Purchase({ onPurchased }) {
  const [config, setConfig] = useState(null),
    [account, setAccount] = useState(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const epoch = useRef(0);
  async function load() {
    const generation = ++epoch.current;
    setError("");
    setBusy(true);
    try {
      const [configResult, accountResult] = await Promise.allSettled([
        purchaseRequest("config"),
        purchaseRequest("status"),
      ]);
      if (generation !== epoch.current) return;
      if (accountResult.status === "rejected") throw accountResult.reason;
      const a = accountResult.value;
      const sessionId = new URLSearchParams(window.location.search).get(
        "session_id",
      );
      // Verified buyers can reopen their workspace during a pricing outage.
      if (a.purchased && !sessionId) {
        setConfig({ enabled: true, required: a.required, mode: a.mode });
        setAccount(a);
        onPurchased?.();
        return;
      }
      if (configResult.status === "rejected") throw configResult.reason;
      const c = configResult.value;
      setConfig(c);
      if (!c.enabled) {
        setAccount(null);
        return;
      }
      setAccount(a);
      if (sessionId && a.connected) {
        const receipt = await purchaseRequest("confirm", {
          method: "POST",
          account: a.subject,
          body: JSON.stringify({ sessionId }),
        });
        if (generation !== epoch.current) return;
        setAccount({ ...a, purchased: receipt.purchased });
        setMessage(
          receipt.purchased
            ? "Your purchase is ready."
            : ["refunded", "disputed", "failed", "expired"].includes(
                  receipt.status,
                )
              ? "This payment does not provide active access. Contact support if you need help."
              : "Your payment is still being confirmed. Check again in a moment; you will not be charged again.",
        );
        if (receipt.purchased) {
          window.history.replaceState(null, "", window.location.pathname);
          onPurchased?.();
        }
      } else if (a.purchased) onPurchased?.();
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("cancelled"))
      setMessage("Checkout was cancelled. You can return when ready.");
    load();
    return () => {
      epoch.current++;
    };
  }, []);
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const result = await purchaseRequest("checkout", {
        method: "POST",
        account: account.subject,
      });
      if (result.purchased) {
        setAccount({ ...account, purchased: true });
        onPurchased?.();
      } else if (result.processing)
        setMessage(
          "Your payment is being confirmed. Check again shortly; you will not be charged again.",
        );
      else if (
        result.url &&
        new URL(result.url).origin === "https://checkout.stripe.com"
      )
        window.location.assign(result.url);
      else throw new Error("Checkout is unavailable. Please try again.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function backup() {
    setBusy(true);
    setError("");
    try {
      const [{ createBackup }, { download }] = await Promise.all([
        import("./backup.js"),
        import("./storage.js"),
      ]);
      download(await createBackup(), "streamlion-device-backup.json");
      setMessage(
        "Your device backup was downloaded. Google files remain in your Google account.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const amount = config?.amount
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(config.amount / 100)
    : "";
  return (
    <section className="purchase-card" aria-labelledby="purchase-title">
      <a className="purchase-brand" href="/api/welcome">
        <img src="/lion.png" alt="" width="36" height="36" />
        StreamLion
      </a>
      <h1 id="purchase-title">
        {account?.purchased
          ? "Your workspace is ready"
          : "Own your field workspace"}
      </h1>
      <p>One purchase. Your projects stay in your Google account.</p>
      {config?.mode === "test" && (
        <p className="purchase-test" role="note">
          Test checkout — use Stripe’s test card. No real payment is taken. Test
          access does not become a live purchase.
        </p>
      )}
      {!config && !error && <p role="status">Checking purchase options…</p>}
      {config?.enabled === false && (
        <p>
          Sales are not open yet.{" "}
          <a href="/api/welcome">Return to StreamLion</a>.
        </p>
      )}
      {config?.enabled && (
        <>
          <ol className="purchase-steps" aria-label="Purchase steps">
            <li className={account?.connected ? "done" : "current"}>Sign in</li>
            <li
              className={
                account?.purchased
                  ? "done"
                  : account?.connected
                    ? "current"
                    : ""
              }
            >
              Pay once
            </li>
            <li className={account?.purchased ? "current" : ""}>
              Open your workspace
            </li>
          </ol>
          {account?.purchased ? (
            <>
              <p>
                Your purchase is linked to <strong>{account.account}</strong>.
                Use this Google account on your other devices.
              </p>
              <a className="purchase-primary" href="/">
                Open workspace
              </a>
            </>
          ) : (
            <>
              <p className="purchase-price">
                {amount} <small>USD · one-time purchase</small>
              </p>
              {config.launchRemaining > 0 && (
                <p>
                  Launch price for the first 100 purchases. Your final price is
                  shown before payment.
                </p>
              )}
              <p>
                {config.refundDays}-day full refund.{" "}
                <a href="/api/terms" target="_blank" rel="noreferrer">
                  Purchase terms
                </a>{" "}
                ·{" "}
                <a href="/api/privacy" target="_blank" rel="noreferrer">
                  Privacy
                </a>
              </p>
              {!account?.connected ? (
                <>
                  <p>
                    Choose the Google account you will use for your projects.
                    Already purchased? The same sign-in restores access.
                  </p>
                  <a
                    className="purchase-primary"
                    href="/api/google/start?returnTo=purchase"
                  >
                    Continue with Google
                  </a>
                </>
              ) : (
                <>
                  <p>
                    Purchase for <strong>{account.account}</strong>
                  </p>
                  <button
                    className="purchase-primary"
                    onClick={checkout}
                    disabled={busy}
                  >
                    {busy ? "Checking…" : "Continue to secure checkout"}
                  </button>
                  <p>
                    <a href="/api/google/start?returnTo=purchase">
                      Use a different Google account
                    </a>
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {(error || message) && (
        <button disabled={busy} onClick={load}>
          {busy ? "Checking…" : "Check again"}
        </button>
      )}
      <footer>
        <p>
          <button onClick={backup} disabled={busy}>
            Download my device backup
          </button>
        </p>
        <a href="mailto:info@transcendencemedia.com">Need help?</a> ·
        Transcendence Media LLC
      </footer>
    </section>
  );
}
