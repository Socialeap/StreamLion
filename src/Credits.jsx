import { useEffect, useRef, useState } from "react";
import { Info, WalletCards, ListChecks, BadgeDollarSign } from "lucide-react";
import { AppHeader, SectionNavigation } from "./AppNavigation.jsx";
import { creditLabel } from "./managed-ai.js";
import ProjectValue from "./ProjectValue.jsx";
import { projectCreditPrice, usd } from "./project-credit-price.js";
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
  const projectPrice = projectCreditPrice(config?.packs, config?.projectMicros);
  const firstPack =
    projectPrice !== null
      ? config.packs.reduce(
          (first, pack) =>
            !first || pack.amount < first.amount ? pack : first,
          null,
        )
      : null;
  return (
    <>
      <AppHeader
        account={account?.account || ""}
        connected={!!account?.connected}
        checking={!account && !error}
      />
      <main className="purchase-content credits-content">
        <section
          className="purchase-card credits-card"
          aria-labelledby="credits-title"
        >
          <div id="credits-value" className="credits-intro">
            <p className="credits-eyebrow">
              Credits for shared capture projects
            </p>
            <h1 id="credits-title">
              One shared brief. Less time chasing details.
            </h1>
            <p>
              Agree what needs capturing, keep instructions and changes
              together, and give your client one place to follow the work.
            </p>
          </div>
          <section
            id="credits-project-price"
            className="credits-project-price"
            aria-label="Typical project cost"
          >
            <div>
              <span className="credits-price-label">
                {Number.isSafeInteger(config?.projectMicros) &&
                config.projectMicros > 0
                  ? `${creditLabel(config.projectMicros)} per confirmed project`
                  : "Project credit charge unavailable"}
              </span>
              <strong>
                {projectPrice !== null
                  ? usd(projectPrice)
                  : config || error
                    ? "Dollar estimate unavailable"
                    : "Checking dollar equivalent…"}
              </strong>
              <span>Typical project credit usage · paid by the provider</span>
            </div>
            <p>
              One project charge after both sides approve the current brief.
              Clients use their invited project portal free.
            </p>
            {config?.mode === "test" ? (
              <p className="credits-availability">
                Test mode · test credits have no cash value.
                {config.enabled === false && " Purchases are closed."}
              </p>
            ) : config?.enabled === false ? (
              <p className="credits-availability">Purchases are closed.</p>
            ) : null}
          </section>
          <p className="credits-price-note">
            This is credit usage from your wallet, not a separate project
            checkout.
            {projectPrice !== null && firstPack && (
              <>
                {" "}
                Packs start at {creditLabel(firstPack.creditsMicros)} for{" "}
                {usd(firstPack.amount)}.
              </>
            )}{" "}
            The app purchase is separate. Your actual project charge is shown
            before you approve it.
          </p>
          <section id="credits-benefits">
            <ProjectValue />
          </section>
          <section
            id="credits-included"
            className="credits-included"
            aria-label="What the project charge covers"
          >
            <h2>What the project charge covers</h2>
            <ul>
              <li>
                A shared brief with capture areas, expected outputs and site
                instructions.
              </li>
              <li>
                Review and approval by both sides, with changes kept in the
                project history.
              </li>
              <li>
                A private client portal for saved updates, progress and delivery
                links.
              </li>
            </ul>
            <p>
              For a renovation team, designer, property manager or owner, that
              means clearer instructions before the visit and less searching for
              the latest information afterward.
            </p>
          </section>
          <section id="credits-wallet" aria-label="Credit wallet">
            <h2>Your credit wallet</h2>
            <p>
              Add credits when you need them. No subscription or automatic
              recharge.
            </p>
            <p>
              AI answers are optional and separately enabled. Buying credits
              does not turn them on.
            </p>
            {(config?.mode || account?.mode) === "test" && (
              <p className="purchase-test" role="note">
                Stripe test checkout. Test credits have no monetary value and
                cannot pay for live jobs or AI answers.
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
              <>
                <p>
                  Credit purchases are not open yet. Your saved-detail voice
                  lookup remains included in StreamLion.
                </p>
                {!account?.connected && (
                  <a href="/api/google/start?returnTo=credits">
                    Sign in to restore or check access
                  </a>
                )}
              </>
            )}
            {config?.enabled && config.checkoutMode === "owner_qa" && (
              <p role="note">
                Checkout is available for your approved QA account. Other
                accounts cannot start a purchase.
                {config.mode === "live" &&
                  " Live Stripe checkout uses real money."}
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
                Purchased credits stay with this Google account across devices
                and do not expire. Credits are separate from your one-time app
                purchase. Promotional starter credits follow the eligibility
                shown in client requests.
              </p>
            )}
          </section>
          <section id="credit-uses" aria-labelledby="credit-uses-title">
            <h2 id="credit-uses-title">When are credits used?</h2>
            <p>
              Creating a request uses no project credits. The provider reviews
              and authorizes the charge before both sides approve the brief. One
              project charge applies when that agreement is complete. Reopening
              or recovering the same job does not add a second job charge.
              Client access follows the access and archive dates shown in the
              project. <a href="/api/client-requests">See client requests</a>.
            </p>
            <p>
              Optional AI answers show their credit charge before you ask.
              Incomplete text answers return reserved credits; a completed text
              answer uses the quoted credits even if spoken playback is
              unavailable. Saved-detail lookup remains included in Core.
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
      </main>
      <SectionNavigation
        sections={[
          { id: "credits-value", label: "Value", icon: ListChecks },
          {
            id: "credits-project-price",
            label: "Project cost",
            icon: BadgeDollarSign,
          },
          { id: "credits-benefits", label: "Benefits", icon: ListChecks },
          { id: "credits-included", label: "Included", icon: Info },
          { id: "credits-wallet", label: "Wallet", icon: WalletCards },
          { id: "credit-uses", label: "Credit uses", icon: Info },
        ]}
      />
    </>
  );
}
