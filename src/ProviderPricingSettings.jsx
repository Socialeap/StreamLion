import React, { useEffect, useRef, useState } from "react";
import { fetchRead } from "./network.js";
import { blankPricing, validatePricing } from "./provider-pricing.js";
import PricingEditor from "./PricingEditor.jsx";
export async function pricingAPI(body, subject) {
  const response = await fetchRead("/api/provider-pricing", {
    credentials: "same-origin",
    ...(body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-StreamLion-Account": subject,
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Pricing is unavailable.");
  return result;
}
export default function ProviderPricingSettings({
  connected,
  account,
  disabled = false,
  onBusy = () => {},
  api = pricingAPI,
  suggestion = null,
}) {
  const [state, setState] = useState(null),
    [draft, setDraft] = useState({
      id: "default",
      name: "Default pricing",
      version: 0,
      config: blankPricing(),
    }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const generation = useRef(0),
    ownsBusy = useRef(false),
    busyCallback = useRef(onBusy),
    suggestionRef = useRef(suggestion);
  busyCallback.current = onBusy;
  suggestionRef.current = suggestion;
  const loadProfile = (data, id = "default") => {
    setState(data);
    // An unpublished default starts from the setup assistant's pricing.
    const suggested = id === "default" && suggestionRef.current;
    setDraft(
      data.profiles.find((p) => p.id === id) || {
        id,
        name: "Default pricing",
        version: 0,
        config: suggested ? structuredClone(suggested) : blankPricing(),
      },
    );
    return !data.profiles.some((p) => p.id === id) && !!suggested;
  };
  useEffect(() => {
    const current = ++generation.current;
    setState(null);
    setError("");
    setNotice("");
    setBusy(false);
    if (connected)
      api()
        .then((data) => {
          if (data.account && data.account !== account)
            throw new Error("Your Google account changed. Reopen Account.");
          if (
            generation.current === current &&
            loadProfile(data) &&
            data.available
          )
            setNotice(
              "Filled in from your setup assistant answers. Preview, then publish when ready.",
            );
        })
        .catch((e) => {
          if (generation.current === current) setError(e.message);
        });
    return () => {
      generation.current++;
      if (ownsBusy.current) {
        ownsBusy.current = false;
        busyCallback.current(false);
      }
    };
  }, [connected, account, attempt, api]);
  async function save(e) {
    e.preventDefault();
    const current = generation.current;
    setBusy(true);
    ownsBusy.current = true;
    busyCallback.current(true);
    setError("");
    setNotice("");
    try {
      const config = validatePricing(draft.config),
        data = await api({ ...draft, config }, state.subject);
      if (generation.current === current) {
        loadProfile(data, draft.id);
        setNotice(
          "Pricing published. New forms use this version. To update an existing public link, use Update form pricing in Client requests. Submitted requests keep their original prices.",
        );
      }
    } catch (e) {
      if (generation.current === current) setError(e.message);
    } finally {
      if (generation.current === current) {
        setBusy(false);
        ownsBusy.current = false;
        busyCallback.current(false);
      }
    }
  }
  const locked = disabled || busy || !state?.available;
  return (
    <section className="pricing-settings" aria-labelledby="pricing-title">
      <h2 id="pricing-title">Pricing &amp; Estimates</h2>
      <p>
        Set your default prices and named profiles for different services. In
        Client requests → Services &amp; intake templates, select a profile for
        each service. Preview and publish explicitly; existing requests are
        kept.
      </p>
      {!connected ? (
        <p>Sign in to Google to configure pricing.</p>
      ) : (
        <>
          {!state && !error && <p role="status">Loading pricing…</p>}
          {error && <p role="alert">{error}</p>}
          {!state && error && (
            <button type="button" onClick={() => setAttempt((v) => v + 1)}>
              Retry pricing load
            </button>
          )}
          {state && !state.available && (
            <p>
              Pricing setup awaits activation. Existing request prices are
              unchanged.
            </p>
          )}
          {state && (
            <form onSubmit={save}>
              <label>
                Pricing profile
                <select
                  value={draft.id}
                  disabled={locked}
                  onChange={(e) => {
                    loadProfile(state, e.target.value);
                    setNotice("");
                    setError("");
                  }}
                >
                  <option value="default">Account default</option>
                  {state.profiles
                    .filter((p) => p.id !== "default")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  {!state.profiles.some((p) => p.id === draft.id) &&
                    draft.id !== "default" && (
                      <option value={draft.id}>{draft.name} · unsaved</option>
                    )}
                </select>
              </label>
              <button
                type="button"
                disabled={
                  locked ||
                  state.profiles.filter((p) => p.id !== "default").length >= 9
                }
                onClick={() => {
                  setDraft({
                    id: "price-" + crypto.randomUUID(),
                    name: "New service pricing",
                    version: 0,
                    config: blankPricing(),
                  });
                  setNotice("");
                  setError("");
                }}
              >
                Add service pricing profile
              </button>
              <label>
                Pricing profile name
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <p>
                {draft.version
                  ? `Published version ${draft.version}. Edits below are not published yet.`
                  : "No published pricing for this profile yet."}
              </p>
              <PricingEditor
                key={draft.id}
                config={draft.config}
                disabled={locked}
                onChange={(config) => setDraft({ ...draft, config })}
              />
              <button disabled={locked}>
                {busy ? "Publishing pricing…" : "Publish pricing for new forms"}
              </button>
            </form>
          )}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}
