export const BUSINESS_REVIEW_MESSAGE =
  "Payment received. Your business tax details need checking before access or credits can be issued. Do not pay again. Check again shortly; if this continues, contact info@transcendencemedia.com with your receipt.";

export default function BusinessPurchaseConsent({
  checked,
  onChange,
  disabled,
}) {
  return (
    <label className="business-purchase-consent">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        I am purchasing for business or professional use.
        <small>
          Sole traders are welcome. Enter your legal business name in Stripe. A
          business purchase does not automatically qualify for tax relief.
          Clients can use their invitations free.
        </small>
      </span>
    </label>
  );
}

// A lost Checkout response may leave no return URL in this browser. Retain the
// original server-owned session for Check again; never create another payment.
export function rememberBusinessReview(result) {
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(result.sessionId || "")) return;
  const url = new URL(window.location.href);
  url.searchParams.set("session_id", result.sessionId);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
