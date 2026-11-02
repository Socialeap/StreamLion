import BusinessPurchaseConsent, {
  BUSINESS_REVIEW_MESSAGE,
  rememberBusinessReview,
} from "./BusinessPurchaseConsent.jsx";
import { useEffect, useRef, useState } from "react";
import { AppHeader, BottomNavigation } from "./AppNavigation.jsx";
import { purchaseRequest } from "./purchase-api.js";
import { coreRefundRequestText } from "./refund-policy.js";
export default function Purchase({ onPurchased }) {
  const [config, setConfig] = useState(null),
    [account, setAccount] = useState(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [businessUse, setBusinessUse] = useState(false);
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
      if (a.purchased) {
        if (sessionId)
          window.history.replaceState(null, "", window.location.pathname);
        setConfig({ enabled: true, required: a.required, mode: a.mode });
        setAccount(a);
        setBusinessUse(false);
        onPurchased?.();
        return;
      }
      setAccount(a);
      // Existing payments must recover independently of new checkout availability.
      if (sessionId && a.connected) {
        const receipt = await purchaseRequest("confirm", {
          method: "POST",
          account: a.subject,
          body: JSON.stringify({ sessionId }),
        });
        if (generation !== epoch.current) return;
        setAccount({ ...a, purchased: receipt.purchased });
        setMessage(
          receipt.businessReview
            ? BUSINESS_REVIEW_MESSAGE
            : receipt.purchased
              ? "Your purchase is ready."
              : ["refunded", "disputed", "failed", "expired"].includes(
                    receipt.status,
                  )
                ? "This payment does not provide active access. Contact support if you need help."
                : "Your payment is still being confirmed. Check again in a moment; you will not be charged again.",
        );
        if (receipt.purchased) {
          setConfig({ enabled: true, required: a.required, mode: a.mode });
          window.history.replaceState(null, "", window.location.pathname);
          onPurchased?.();
          return;
        }
      }
      if (configResult.status === "rejected") throw configResult.reason;
      setConfig(configResult.value);
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
      setMessage("Checkout was cancelled. You can return when ready.");
    load();
    return () => {
      epoch.current++;
    };
  }, []);
  async function checkout() {
    if (config?.businessUseRequired && !businessUse) {
      setError("Confirm business or professional use before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await purchaseRequest("checkout", {
        method: "POST",
        account: account.subject,
        body: JSON.stringify({ businessUse }),
      });
      if (result.purchased) {
        setAccount({ ...account, purchased: true });
        onPurchased?.();
      } else if (result.businessReview) {
        rememberBusinessReview(result);
        setMessage(BUSINESS_REVIEW_MESSAGE);
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
  async function requestRefund() {
    const subject = account?.subject,
      generation = epoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await purchaseRequest("refund", {
        method: "POST",
        account: subject,
        body: "{}",
      });
      if (generation !== epoch.current) return;
      setAccount((a) => ({
        ...a,
        guarantee: result.guarantee,
        purchased: result.purchased,
      }));
      setMessage(
        "Your refund request is recorded. Its original receipt time determines eligibility.",
      );
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  const amount = config?.amount
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(config.amount / 100)
    : "";
  return (
    <>
      <AppHeader
        account={account?.account || ""}
        connected={!!account?.connected}
        checking={!account && !error}
      />
      <main className="purchase-content">
        <section className="purchase-card" aria-labelledby="purchase-title">
          <h1 id="purchase-title">
            {account?.purchased
              ? "Your workspace is ready"
              : "Own your field workspace"}
          </h1>
          <p>One purchase. Your projects stay in your Google account.</p>
          {config?.mode === "test" && (
            <p className="purchase-test" role="note">
              Test checkout — use Stripe’s test card. No real payment is taken.
              Test access does not become a live purchase.
            </p>
          )}
          {!config && !error && <p role="status">Checking purchase options…</p>}
          {config?.enabled === false && (
            <>
              <p>
                New purchases are paused. Existing purchases can still be
                restored or confirmed.
              </p>
              <a href="/api/google/start?returnTo=purchase">
                {account?.connected
                  ? "Use a different Google account"
                  : "Sign in to restore or check access"}
              </a>
              <p>
                <a href="/api/welcome">Return to StreamLion</a>.
              </p>
            </>
          )}
          {config?.enabled &&
            config.checkoutMode === "owner_qa" &&
            !account?.purchased && (
              <p role="note">
                Checkout is available for your approved QA account. Other
                accounts cannot start a purchase.
                {config.mode === "live" &&
                  " Live Stripe checkout uses real money."}
              </p>
            )}
          {config?.enabled && (
            <>
              <ol className="purchase-steps" aria-label="Purchase steps">
                <li className={account?.connected ? "done" : "current"}>
                  Sign in
                </li>
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
                    Your purchase is linked to{" "}
                    <strong>{account.account}</strong>. Use this Google account
                    on your other devices.
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
                  {config.taxMode === "stripe" && (
                    <p>
                      Plus applicable taxes. Enter your billing address in
                      Stripe Checkout to see the tax and final total before
                      paying.
                    </p>
                  )}
                  <p>
                    Pay once. Purchased Core access continues after day 14. No
                    subscription or later charge.
                  </p>
                  {config.promotionPhase === "promotion" && (
                    <p>
                      $29.95 promotional price through{" "}
                      {new Date(config.promotionEndsAt - 1).toLocaleString(
                        "en-US",
                        { timeZone: "America/New_York", timeZoneName: "short" },
                      )}
                      ; then $39.95 for new checkouts. A checkout already issued
                      keeps its quoted price until it expires.
                    </p>
                  )}
                  <p>
                    {config.refundDays}-day money-back guarantee.{" "}
                    {coreRefundRequestText(config.refundDays)}{" "}
                    <a href="/api/terms" target="_blank" rel="noreferrer">
                      Purchase terms
                    </a>{" "}
                    ·{" "}
                    <a href="/api/privacy" target="_blank" rel="noreferrer">
                      Privacy
                    </a>
                  </p>
                  <p>
                    <a href="/api/purchase">
                      Request a refund from this account page
                    </a>
                    . The deadline is 14 × 24 hours after successful payment;
                    bank processing time is separate.
                  </p>
                  {!account?.connected ? (
                    <>
                      <p>
                        Sign in with a Google-confirmed email. Choose the
                        account you will use for your projects. Already
                        purchased? The same sign-in restores access.
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
                      {config.businessUseRequired && (
                        <BusinessPurchaseConsent
                          checked={businessUse}
                          onChange={setBusinessUse}
                          disabled={busy}
                        />
                      )}
                      <button
                        className="purchase-primary"
                        onClick={checkout}
                        disabled={
                          busy || (config.businessUseRequired && !businessUse)
                        }
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
          {account?.guarantee && (
            <section aria-label="Core refund guarantee">
              <h2>Purchase and refund</h2>
              {account.guarantee.deadline ? (
                <p>
                  Refund request deadline:{" "}
                  {new Date(account.guarantee.deadline).toLocaleString(
                    undefined,
                    { timeZone: "UTC", timeZoneName: "short" },
                  )}
                  . Requests received at this exact deadline qualify.
                </p>
              ) : (
                <p>
                  Confirming your successful-payment timestamp and refund
                  deadline.
                </p>
              )}
              {account.guarantee.receivedAt && (
                <p>
                  Request received:{" "}
                  {new Date(account.guarantee.receivedAt).toISOString()}.
                </p>
              )}
              {account.guarantee.state && (
                <p role="status">
                  {
                    {
                      requested:
                        "Request recorded; verification and refund initiation are automatic.",
                      pending:
                        "Refund pending with Stripe. Your request is recorded; bank processing is separate.",
                      succeeded:
                        "Full refund succeeded. This purchase no longer provides Core access.",
                      failed:
                        "Refund processing needs attention and will be checked automatically. Your original request time is preserved.",
                      ineligible:
                        "This request was received after the guarantee deadline. Contact support for any other applicable rights.",
                    }[account.guarantee.state]
                  }
                </p>
              )}
              {account.guarantee.canRequest && (
                <button disabled={busy} onClick={requestRefund}>
                  Request full Core refund
                </button>
              )}
              <p>
                A successful full refund ends access from this purchase.
                Google-owned files remain yours; download your device backup
                below. Other purchases remain separate.
              </p>
            </section>
          )}
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
      </main>
      <BottomNavigation page="Account" />
    </>
  );
}
