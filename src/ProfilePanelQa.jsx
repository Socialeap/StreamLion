import React, { useEffect, useState } from "react";
import { ProfileConnection } from "./F3DProfileConnection.jsx";
// Mount the actual production profile panel, never the licensed app/workspace.
export default function ProfilePanelQa({ account, expiresAt }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [expired, setExpired] = useState(Date.now() >= expiresAt);
  useEffect(() => {
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, expiresAt - Date.now()),
    );
    const sync = () => {
      setOnline(navigator.onLine);
      setExpired(Date.now() >= expiresAt);
    };
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("focus", sync);
    };
  }, [expiresAt]);
  return (
    <main className="purchase-shell">
      <section className="purchase-card">
        <h1>Profile connection QA</h1>
        <p>
          Signed in as {account}. Temporary profile-panel access expires{" "}
          {new Date(expiresAt).toLocaleString()}.
        </p>
        {expired ? (
          <p role="status">Temporary QA access has ended.</p>
        ) : !online ? (
          <p role="status">An internet connection is required.</p>
        ) : (
          <ProfileConnection connected account={account} />
        )}
        <p>
          <a href="/api/google/start?returnTo=purchase">
            Switch Google account
          </a>
        </p>
        <p>
          <a href="/api/purchase">Purchase and license</a>
        </p>
      </section>
    </main>
  );
}
