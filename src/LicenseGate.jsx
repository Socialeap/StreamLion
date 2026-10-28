import { useEffect, useState } from "react";
import { pilotRequest, pilotReceipt, pilotDate } from "./pilot-api.js";
import { purchaseRequest } from "./purchase-api.js";
import Purchase from "./Purchase.jsx";
import { AppHeader, BottomNavigation } from "./AppNavigation.jsx";
const KEY = "streamlion-purchase-receipt-v1";
export default function LicenseGate({ children }) {
  const [pilot, setPilot] = useState(null);
  const [ownerQa, setOwnerQa] = useState(null);
  const [allowed, setAllowed] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function check(background = false) {
    if (!background) setLoading(true);
    setError("");
    try {
      const receipt = await purchaseRequest("status");
      const qa =
        navigator.onLine &&
        receipt.connected === true &&
        !receipt.purchased &&
        receipt.ownerQa?.scope === "google-workspace" &&
        Number.isSafeInteger(receipt.ownerQa.expiresAt) &&
        receipt.ownerQa.expiresAt > Date.now() &&
        receipt.ownerQa.expiresAt <= Date.now() + 86400000
          ? receipt.ownerQa
          : null;
      setOwnerQa(qa);
      let free = null;
      if (receipt.required && !receipt.purchased && !qa) {
        try {
          const status = await pilotRequest("status");
          setPilot(status.enabled ? status : null);
          free = pilotReceipt(status);
        } catch {
          setPilot(null);
        }
      } else setPilot(null);
      setAllowed(!receipt.required || receipt.purchased || !!free || !!qa);
      // A bounded device cache permits paid or unexpired pilot local work offline.
      // This is not an authorization credential: server Google routes always
      // verify the account's durable purchase; browser storage grants no API access.
      try {
        if (qa) localStorage.removeItem(KEY);
        else if (!receipt.required || receipt.purchased || free)
          localStorage.setItem(
            KEY,
            JSON.stringify(free || { expires: Date.now() + 7 * 86400000 }),
          );
        else localStorage.removeItem(KEY);
      } catch {
        /* storage is optional */
      }
    } catch (e) {
      let offline = false;
      try {
        const cached = JSON.parse(localStorage.getItem(KEY));
        offline =
          !navigator.onLine &&
          Number.isSafeInteger(cached?.expires) &&
          cached.expires > Date.now();
        if (offline && cached.pilot === true)
          setPilot({ enabled: true, active: true, endsAt: cached.expires });
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
  useEffect(() => {
    if (!ownerQa) return;
    const refresh = () => check(true);
    const offline = () => {
      setAllowed(false);
      setError("Owner QA access requires an internet connection.");
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    const interval = setInterval(refresh, 60000);
    const timeout = setTimeout(
      () => {
        setAllowed(false);
        setOwnerQa(null);
      },
      Math.max(0, ownerQa.expiresAt - Date.now()),
    );
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [ownerQa?.expiresAt]);
  useEffect(() => {
    if (!pilot?.enabled) return;
    const refresh = () => check(true);
    window.addEventListener("focus", refresh);
    const interval = setInterval(refresh, 60000);
    const until = pilot.endsAt - Date.now();
    const timeout =
      pilot.active && until > 0
        ? setTimeout(
            () => {
              setAllowed(false);
              setPilot((p) => ({ ...p, active: false, state: "expired" }));
            },
            Math.min(until, 2147483647),
          )
        : null;
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, [pilot?.enabled, pilot?.endsAt, pilot?.active]);
  const pilotNotice = pilot?.enabled ? (
    <aside className="pilot-banner">
      <p>
        {pilot.active
          ? `Free pilot expires ${pilotDate(pilot.endsAt)}.`
          : pilot.startsAt || pilot.state === "expired"
            ? "Your pilot access has ended. Your Google files and device backup remain available."
            : "Pilot admission requires approval and explicit activation."}{" "}
        <a href="/pilot/">Pilot status and work retrieval</a>
      </p>
    </aside>
  ) : null;
  if (loading)
    return (
      <div className="purchase-shell">
        <AppHeader checking />
        <p role="status">Opening StreamLion…</p>
        <BottomNavigation />
      </div>
    );
  if (allowed)
    return (
      <>
        {ownerQa && (
          <aside className="pilot-banner" role="status">
            Owner QA workspace access expires {pilotDate(ownerQa.expiresAt)}.
            Online access only.
          </aside>
        )}
        {pilotNotice}
        {children}
      </>
    );
  if (error)
    return (
      <div className="purchase-shell">
        <AppHeader />
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
        <BottomNavigation />
      </div>
    );
  return (
    <div className="purchase-shell">
      {pilotNotice}
      <Purchase onPurchased={() => check()} />
    </div>
  );
}
