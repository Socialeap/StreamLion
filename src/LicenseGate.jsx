import { useEffect, useState } from "react";
import { purchaseRequest } from "./purchase-api.js";
import Purchase from "./Purchase.jsx";
const KEY = "streamlion-purchase-receipt-v1";
export default function LicenseGate({ children }) {
  const [allowed, setAllowed] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function check() {
    setLoading(true);
    setError("");
    try {
      const receipt = await purchaseRequest("status");
      setAllowed(!receipt.required || receipt.purchased);
      // A short-lived device cache permits already-paid local work offline.
      // This is not an authorization credential: server Google routes always
      // verify the account's durable purchase; browser storage grants no API access.
      try {
        if (!receipt.required || receipt.purchased)
          localStorage.setItem(
            KEY,
            JSON.stringify({ expires: Date.now() + 7 * 86400000 }),
          );
        else localStorage.removeItem(KEY);
      } catch {
        /* storage is optional */
      }
    } catch (e) {
      let offline = false;
      try {
        offline =
          !navigator.onLine &&
          JSON.parse(localStorage.getItem(KEY))?.expires > Date.now();
      } catch {
        /* optional cache */
      }
      setAllowed(offline);
      if (!offline) setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    check();
  }, []);
  if (loading)
    return (
      <div className="purchase-shell">
        <p role="status">Opening StreamLion…</p>
      </div>
    );
  if (allowed) return children;
  if (error)
    return (
      <div className="purchase-shell">
        <section className="purchase-card">
          <h1>Let’s try again</h1>
          <p role="alert">{error}</p>
          <button className="purchase-primary" onClick={check}>
            Try again
          </button>
          <p>
            <a href="/api/purchase">Purchase and device backup options</a>
          </p>
          <p>
            <a href="/api/welcome">About StreamLion</a>
          </p>
        </section>
      </div>
    );
  return (
    <div className="purchase-shell">
      <Purchase onPurchased={check} />
    </div>
  );
}
