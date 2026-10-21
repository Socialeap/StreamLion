import BusinessPurchaseConsent, {
  BUSINESS_REVIEW_MESSAGE,
  rememberBusinessReview,
} from "./BusinessPurchaseConsent.jsx";
import { useEffect, useRef, useState } from "react";
import {
  Info,
  WalletCards,
  ListChecks,
  BadgeDollarSign,
  CreditCard,
  Table2,
} from "lucide-react";
import { AppHeader, SectionNavigation } from "./AppNavigation.jsx";
import { creditLabel } from "./managed-ai.js";
import ProjectValue from "./ProjectValue.jsx";
import BriefPrivacyNotice from "./BriefPrivacyNotice.jsx";
import { priceLabels, projectCreditPrice } from "./project-credit-price.js";
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
const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const BRANDS = {
  amex: "American Express",
  discover: "Discover",
  mastercard: "Mastercard",
  visa: "Visa",
};
export const cardLabel = (card) =>
  `${BRANDS[card.brand] || card.brand.charAt(0).toUpperCase() + card.brand.slice(1)} •••• ${card.last4}`;
const coverage = (count) =>
  `Covers ${count} Coordination ${count === 1 ? "page" : "pages"}`;
function PricePill({ state }) {
  if (state.status !== "open")
    return (
      <span className="credits-pill credits-pill-muted">
        {state.status === "checking" ? "Checking price…" : "Not available yet"}
      </span>
    );
  return (
    <span className="credits-pill">
      <strong>{state.credits}</strong>
      {state.usd && (
        <>
          <span aria-hidden="true"> | </span>
          <span className="credits-sr">, </span>
          {state.usd}
        </>
      )}{" "}
      {state.per}
    </span>
  );
}
export default function Credits() {
  const [config, setConfig] = useState(null),
    [account, setAccount] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saveCard, setSaveCard] = useState(false),
    [chosen, setChosen] = useState(null),
    [bankCheck, setBankCheck] = useState(null);
  const [businessUse, setBusinessUse] = useState(false);
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
      setBusinessUse(false);
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
          result.businessReview
            ? BUSINESS_REVIEW_MESSAGE
            : result.status === "paid"
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
  async function buy(packId, save = false) {
    if (submitting.current || busy || !account?.connected) return;
    if (config?.businessUseRequired && !businessUse) {
      setError("Confirm business or professional use before continuing.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await creditRequest("checkout", {
        method: "POST",
        account: account.subject,
        body: JSON.stringify({
          packId,
          ...(config?.businessUseRequired ? { businessUse } : {}),
          ...(save ? { saveCard: true } : {}),
        }),
      });
      if (result.licenseRequired)
        setError(
          "Purchase StreamLion with this Google account before adding credits.",
        );
      else if (result.pendingAmount)
        setMessage(
          `You already have a pending $${(result.pendingAmount / 100).toFixed(2)} top-up. Choose that pack to continue it, or wait for its checkout to expire before changing packs.`,
        );
      else if (result.businessReview) {
        rememberBusinessReview(result);
        setMessage(BUSINESS_REVIEW_MESSAGE);
      } else if (result.processing)
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
  // Charges the saved card for the chosen pack, after the holder confirms.
  async function topUp(pack) {
    if (submitting.current || busy || !account?.connected) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setBankCheck(null);
    try {
      const result = await creditRequest("topup", {
        method: "POST",
        account: account.subject,
        body: JSON.stringify({ packId: pack.id }),
      });
      setChosen(null);
      if (result.credited) {
        setMessage("Credits added to your wallet.");
        submitting.current = false;
        await load();
      } else if (result.processing)
        setMessage(
          "Payment is being confirmed. Check again shortly; no new payment is needed.",
        );
      else if (result.authenticationRequired) {
        setBankCheck(pack);
        setMessage(
          "Your bank wants to confirm this payment. Continue in Stripe Checkout to finish it; your saved card was not charged.",
        );
      } else if (result.declined)
        setError(
          "Your saved card was declined and not charged. Pay with another card in Checkout, or remove the saved card.",
        );
      else if (result.cardRequired) {
        setMessage(
          "Your saved card is no longer available. Pay in Checkout to add credits.",
        );
        submitting.current = false;
        await load();
      } else if (result.pendingAmount)
        setMessage(
          `You already have a pending ${money(result.pendingAmount)} top-up. Finish it or wait about an hour before starting another.`,
        );
      else if (result.licenseRequired)
        setError(
          "Purchase StreamLion with this Google account before adding credits.",
        );
      else throw new Error("Top-up is unavailable. Try again.");
    } catch (e) {
      setError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function removeCard() {
    if (submitting.current || busy || !account?.card) return;
    if (
      !window.confirm(
        `Remove ${cardLabel(account.card)}? You can save a card again at your next checkout.`,
      )
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await creditRequest("card", {
        method: "POST",
        account: account.subject,
        body: JSON.stringify({ action: "remove" }),
      });
      setChosen(null);
      setMessage("Saved card removed.");
      submitting.current = false;
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const projectPrice = projectCreditPrice(config?.packs, config?.projectMicros);
  // A feature's pill reflects its live state: checking, closed or priced.
  const pill = (micros, per) => {
    if (!config) return { status: error ? "closed" : "checking" };
    const labels = priceLabels(config.packs, micros);
    return labels ? { status: "open", ...labels, per } : { status: "closed" };
  };
  const stages = [
    {
      title: "1. Set up your request form",
      free: "The setup assistant builds your branded request form and invitation link.",
    },
    {
      title: "2. Client sends a work-order request",
      free: "Your client fills in your form or chats with the request assistant.",
    },
    {
      title: "3. Review the request and agree the brief",
      free: "Ask your client questions, edit the Project Brief together, or decline. Your client follows along on their Request page.",
    },
    {
      title: "4. Prepare the Project Brief",
      free: "Enter project details yourself, or import a saved StreamLion project file.",
      credit: {
        price: pill(config?.briefMicros, "per brief"),
        text: "StreamLion uses OpenAI to organize PDF text, emails or messages into a Project Brief. It first filters detected personal details on your device; you review the text before sending it to OpenAI.",
      },
    },
    {
      title: "5. Coordinate the job with your client",
      free: "Copy the agreed details into your own project, then send updates, changes and results by email, text or phone.",
      credit: {
        price: pill(config?.projectMicros, "per project"),
        text: "You authorize the charge once you and your client mutually approve the Project Brief, which becomes your shared Coordination Brief. You both get a real-time Coordination page that stays in sync: progress, questions, changes and delivery links; archived to your Google Drive once complete, visible to your client for 90 days.",
      },
    },
    {
      title: "6. In the field: add notes",
      free: "Add notes by text, voice or camera photo.",
    },
    {
      title: "7. In the field: ask for project details",
      free: "Saved-detail lookup gives short answers to basic questions (address, site contact, access, visit time, scope, outputs, payment).",
      credit: {
        price: pill(config?.aiMicros, "per answer"),
        text: "AI answers more complex questions using the brief and your field notes. StreamLion filters detected private details in your question and project records before OpenAI receives them, then restores names in the answer.",
      },
    },
  ];
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
          <div id="credits-intro" className="credits-intro">
            <h1 id="credits-title">How credits work</h1>
            <p>
              Credits represent your ability to use optional, automated and
              AI-assisted actions. While every stage of a project can work
              manually without them, they help you work more efficiently. When
              prepaid, credits are available to use for the listed assisted
              options below.
            </p>
            <p className="credits-starter">
              To start, eligible StreamLion app purchasers receive 600 free
              starter credits, enough for two Coordination pages. They are used
              before any credits you buy.
            </p>
            {account?.connected && (
              <p className="credits-balance-line">
                You have <strong>{creditLabel(account.balanceMicros)}</strong>.{" "}
                <a href="#credits-wallet">Add credits</a>
              </p>
            )}
          </div>
          <section id="credits-compare" aria-labelledby="credits-compare-title">
            <h2 id="credits-compare-title">
              Credits at each stage of a project
            </h2>
            <table className="credits-stages">
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Non-Credit Option</th>
                  <th scope="col">Credit-based Option</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage) => (
                  <tr
                    key={stage.title}
                    className={stage.credit ? "credits-stage-paid" : undefined}
                  >
                    <th scope="row">{stage.title}</th>
                    <td data-label="Non-Credit Option">{stage.free}</td>
                    {stage.credit ? (
                      <td data-label="Credit-based Option">
                        <PricePill state={stage.credit.price} />
                        {stage.credit.text}
                      </td>
                    ) : (
                      <td className="credits-stage-none">
                        <span aria-hidden="true">–</span>
                        <span className="credits-sr">
                          No credit-based option
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Optional hosted speech costs 1 credit per clip, up to 1,200
              characters, when available. It reads a saved-detail answer without
              generating an AI answer. Device voice, text and the prerecorded
              voice preview use no credits.
            </p>
            <BriefPrivacyNotice />
            {config?.mode === "test" && (
              <p className="credits-availability">
                Test mode · test credits have no cash value.
              </p>
            )}
          </section>
          <section id="credits-benefits">
            <ProjectValue />
          </section>
          <section id="credits-charges" aria-labelledby="credits-charges-title">
            <h2 id="credits-charges-title">When credits are charged</h2>
            <ul>
              <li>
                Nothing is charged automatically. Each credit-based option shows
                its price, and you confirm it before any credits are used.
              </li>
              <li>
                <strong>Coordination page:</strong> you authorize the charge
                when you approve the Project Brief, and it is taken once your
                client approves too. A declined or unfinished request costs
                nothing. Later edits, corrections or reopening the same job do
                not add a second charge.
              </li>
              <li>
                <strong>Brief preparation and AI answers:</strong> if a brief
                cannot be prepared or an answer does not finish, the reserved
                credits are returned. A finished text answer is charged even if
                spoken playback is unavailable.
              </li>
              <li>
                <strong>Speech-only clips:</strong> review the exact text and
                separate quote before confirming. A failed preparation returns
                reserved purchased credits. A prepared clip is charged once even
                if playback fails; replaying a loaded clip does not buy it
                again. Starter credits are unchanged.
              </li>
              <li>
                Before you share your request form, check that your balance
                covers each job you expect to accept. If it falls short, the
                approval waits until you add credits; the request is kept.
              </li>
            </ul>
          </section>
          <section id="credits-cost" aria-labelledby="credits-cost-title">
            <h2 id="credits-cost-title">Cost</h2>
            {config?.packs?.length > 0 ? (
              <ul className="credits-pack-list" aria-label="Credit packs">
                {[...config.packs]
                  .sort((a, b) => a.amount - b.amount)
                  .map((pack) => (
                    <li key={pack.id}>
                      <strong>{money(pack.amount)}</strong>
                      <span>{creditLabel(pack.creditsMicros)}</span>
                      {Number.isSafeInteger(config.projectMicros) &&
                        config.projectMicros > 0 && (
                          <span>
                            {coverage(
                              Math.floor(
                                pack.creditsMicros / config.projectMicros,
                              ),
                            )}
                          </span>
                        )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>
                {config || error
                  ? "Credit pack prices are unavailable right now."
                  : "Checking credit packs…"}
              </p>
            )}
            <p>
              No subscription, no expiry and no automatic recharge. Credits are
              separate from your one-time StreamLion app purchase.
            </p>
          </section>
          <section id="credits-payment" aria-labelledby="credits-payment-title">
            <h2 id="credits-payment-title">Payment</h2>
            {config?.taxMode === "stripe" && (
              <p>
                Pack prices are before sales tax. Stripe Checkout shows
                applicable tax and the final total before you pay. Tax does not
                change the number of credits you receive.
              </p>
            )}
            <p>
              Pay by card in Stripe Checkout. Credits are added to the Google
              account you are signed in with and work on all your devices.
              {config?.savedCards &&
                " You can save your card for one-tap top-ups; it is charged only when you choose a pack and confirm."}
            </p>
            <p>
              Buying credits does not turn on an option marked “Not available
              yet”. Refunds follow the{" "}
              <a href="/api/terms#ai-credits">credit terms</a>.
            </p>
          </section>
          <section id="credits-wallet" aria-label="Credit wallet">
            <h2>Your wallet</h2>
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
                {account.card && (
                  <div className="credit-card-saved">
                    <p>
                      Saved card: <strong>{cardLabel(account.card)}</strong> ·
                      expires {String(account.card.expMonth).padStart(2, "0")}/
                      {String(account.card.expYear).slice(-2)}
                    </p>
                    <button type="button" disabled={busy} onClick={removeCard}>
                      Remove card
                    </button>
                  </div>
                )}
              </>
            )}
            {!config && !error && <p role="status">Checking credit options…</p>}
            {config?.enabled === false && (
              <>
                <p>
                  Credit purchases are not open yet. Every stage still works
                  with its non-credit option.
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
                <>
                  {config.businessUseRequired && (
                    <BusinessPurchaseConsent
                      checked={businessUse}
                      onChange={setBusinessUse}
                      disabled={busy}
                    />
                  )}
                  {config.savedCards && !account.card && (
                    <label className="credit-save">
                      <input
                        type="checkbox"
                        checked={saveCard}
                        disabled={busy}
                        onChange={(e) => setSaveCard(e.target.checked)}
                      />
                      <span>
                        Save my card for one-tap top-ups
                        <small>
                          Stripe keeps the card. StreamLion charges it only when
                          you choose a pack and confirm — never automatically.
                          Remove it here any time.
                        </small>
                      </span>
                    </label>
                  )}
                  <div
                    className="credit-packs"
                    aria-label="Prepaid credit packs"
                  >
                    {config.packs.map((pack) => (
                      <button
                        key={pack.id}
                        aria-label={`${creditLabel(pack.creditsMicros)} for ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(pack.amount / 100)}`}
                        aria-pressed={
                          config.savedCards && account.card
                            ? chosen?.id === pack.id
                            : undefined
                        }
                        onClick={() =>
                          config.savedCards && account.card
                            ? setChosen(pack)
                            : buy(pack.id, saveCard)
                        }
                        disabled={
                          busy || (config.businessUseRequired && !businessUse)
                        }
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
                  {chosen && account.card && config.savedCards && (
                    <div
                      className="credit-confirm"
                      role="group"
                      aria-label="Confirm top-up"
                    >
                      <p>
                        Add {creditLabel(chosen.creditsMicros)} for{" "}
                        {money(chosen.amount)} with {cardLabel(account.card)}?
                      </p>
                      <button
                        type="button"
                        className="purchase-primary"
                        disabled={busy}
                        onClick={() => topUp(chosen)}
                      >
                        Pay {money(chosen.amount)}
                      </button>
                      <div className="credit-confirm-actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setChosen(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => buy(chosen.id)}
                        >
                          Pay with another card
                        </button>
                      </div>
                    </div>
                  )}
                  {bankCheck && (
                    <button
                      type="button"
                      className="purchase-primary"
                      disabled={busy}
                      onClick={() => buy(bankCheck.id)}
                    >
                      Continue in Checkout
                    </button>
                  )}
                </>
              ))}
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
          { id: "credits-intro", label: "Overview", icon: Info },
          { id: "credits-compare", label: "Compare", icon: Table2 },
          { id: "credits-benefits", label: "Benefits", icon: ListChecks },
          { id: "credits-charges", label: "Charges", icon: Info },
          { id: "credits-cost", label: "Cost", icon: BadgeDollarSign },
          { id: "credits-payment", label: "Payment", icon: CreditCard },
          { id: "credits-wallet", label: "Wallet", icon: WalletCards },
        ]}
      />
    </>
  );
}
