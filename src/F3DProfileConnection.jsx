import React, { useEffect, useRef, useState } from "react";
import { f3dProfileAPI, awaitProfileApproval } from "./f3d-profile-connect.js";

export function ProfileConnection({
  connected,
  account,
  disabled = false,
  api = f3dProfileAPI,
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const generation = useRef(0),
    operation = useRef(null);
  useEffect(() => {
    const id = ++generation.current,
      controller = new AbortController();
    setData(null);
    setError("");
    setBusy(false);
    if (connected)
      api(undefined, undefined, controller.signal)
        .then((result) => {
          if (generation.current === id) {
            if (result.account !== account)
              throw new Error("Your account changed. Reopen setup.");
            setData(result);
          }
        })
        .catch((e) => {
          if (generation.current === id && !controller.signal.aborted)
            setError(e.message);
        });
    return () => {
      generation.current++;
      controller.abort();
      operation.current?.abort();
      operation.current = null;
    };
  }, [connected, account, api, retry]);
  async function reconcileFailure(error, id, controller) {
    if (generation.current !== id || controller.signal.aborted) return;
    setError(error.message);
    try {
      // A POST may have committed before its response was lost. Read the
      // account's saved status; never replay a consumed approval automatically.
      const current = await api(undefined, undefined, controller.signal);
      if (generation.current === id && !controller.signal.aborted) {
        if (current.account !== account)
          throw new Error("Your account changed. Reopen setup.");
        setData(current);
      }
    } catch {
      if (generation.current === id && !controller.signal.aborted)
        setError(
          "Could not confirm the saved connection. Check its status before trying again.",
        );
    }
  }
  async function connect() {
    const popup = window.open("", "_blank", "popup,width=600,height=760");
    if (!popup) {
      setError("Allow the F|3D window to open, then try again.");
      return;
    }
    const id = generation.current,
      controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const pending = await api(
        { action: "start" },
        data.subject,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        pending.connectUrl !==
          "https://www.frontiers3d.com/dashboard/profile?connect=streamlion" ||
        !/^[A-Za-z0-9_-]{43}$/.test(pending.nonce)
      )
        throw new Error("The profile connection could not be started safely.");
      popup.location.href = pending.connectUrl;
      const assertion = await awaitProfileApproval(
        popup,
        pending.nonce,
        controller.signal,
      );
      const result = await api(
        { action: "complete", nonce: pending.nonce, assertion },
        data.subject,
        controller.signal,
      );
      if (generation.current === id) setData(result);
    } catch (e) {
      await reconcileFailure(e, id, controller);
    } finally {
      popup.close();
      if (generation.current === id) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  }
  async function unlink() {
    const id = generation.current,
      controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        { action: "unlink" },
        data.subject,
        controller.signal,
      );
      if (generation.current === id) setData(result);
    } catch (e) {
      await reconcileFailure(e, id, controller);
    } finally {
      if (generation.current === id) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  }
  const b = data?.snapshot?.businessProfile,
    d = data?.snapshot?.directoryProfile;
  return (
    <section
      className="f3d-provider-intro"
      aria-label="F|3D profile connection"
    >
      <h3>Connect your F|3D profile</h3>
      <p>
        Bring your existing F|3D business identity and Directory services into
        setup. Your public profile is managed on F|3D.
      </p>
      {!connected ? (
        <p>
          Sign in to Google in StreamLion before connecting your F|3D account.
        </p>
      ) : !data && !error ? (
        <p role="status">Checking profile connection…</p>
      ) : data && !data.available ? (
        <p>
          The verified profile connection is not enabled yet. You can still
          manage your profile on F|3D.
        </p>
      ) : (
        data && (
          <>
            <p>StreamLion account: {data.account}</p>
            {data.connected && (
              <>
                <p role="status">
                  Profile snapshot connected · Verified{" "}
                  {new Date(data.verifiedAt).toLocaleString()}
                </p>
                <p>
                  This is a saved snapshot. Refresh to retrieve changes made on
                  F|3D. It does not change your product access.
                </p>
                <h4>Public-page profile</h4>
                <p>
                  {b
                    ? [b.name, b.phone, b.city, b.region]
                        .filter(Boolean)
                        .join(" · ")
                    : "No business page profile has been created yet."}
                </p>
                <h4>Directory profile</h4>
                <p>
                  {d
                    ? [
                        d.name,
                        d.city,
                        d.region,
                        ...d.services.map((s) => s.replaceAll("_", " ")),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "No Directory enrollment profile has been created yet."}
                </p>
                {b && d && b.name !== d.name && (
                  <p>
                    Your public-page and Directory names differ. Review them on
                    F|3D; neither was overwritten.
                  </p>
                )}
              </>
            )}
            <div className="f3d-provider-actions">
              <button
                type="button"
                disabled={disabled || busy}
                onClick={connect}
              >
                {busy
                  ? "Connecting…"
                  : data.connected
                    ? "Refresh from F|3D"
                    : "Connect F|3D account"}
              </button>
              {data.connected && (
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={unlink}
                >
                  Unlink profile snapshot
                </button>
              )}
            </div>
          </>
        )
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          {
            <button type="button" onClick={() => setRetry((v) => v + 1)}>
              Retry profile connection
            </button>
          }
        </>
      )}
      <p>
        <a
          href="https://www.frontiers3d.com/dashboard/profile"
          target="_blank"
          rel="noopener noreferrer"
        >
          Manage your F|3D public profile ↗
        </a>
        {" · "}
        <a
          href="https://www.frontiers3d.com/directory#provider-invitation"
          target="_blank"
          rel="noopener noreferrer"
        >
          Manage Directory enrollment ↗
        </a>
      </p>
    </section>
  );
}

export default function F3DProfileConnection(props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="f3d-profile-disclosure"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Connect or refresh your F|3D profile</summary>
      {expanded && <ProfileConnection {...props} />}
    </details>
  );
}
