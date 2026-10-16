import React, { useEffect, useRef, useState } from "react";
import { fetchRead } from "./network.js";
import {
  emptyBranding,
  LOGO_LIMIT,
  validateBranding,
} from "./provider-branding.js";
import ProviderBrand from "./ProviderBrand.jsx";
export async function brandingAPI(body, subject) {
  const response = await fetchRead("/api/provider-branding", {
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
  if (!response.ok)
    throw new Error(result.error || "Business branding is unavailable.");
  return result;
}
export async function prepareLogo(file) {
  if (
    !file ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG or WebP image under 5 MB.");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(new Error("Could not open this logo image."));
      image.src = url;
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 20000000
    )
      throw new Error("Choose a smaller logo image (under 20 megapixels).");
    const canvas = document.createElement("canvas");
    for (const max of [640, 480, 320, 192, 128]) {
      const scale = Math.min(
        1,
        max / image.naturalWidth,
        max / image.naturalHeight,
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const logo = canvas.toDataURL("image/png");
      if (atob(logo.split(",")[1]).length <= LOGO_LIMIT) return logo;
    }
    throw new Error("Choose a simpler or smaller logo image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
export default function ProviderBrandingSettings({
  connected,
  account,
  disabled = false,
  onBusy = () => {},
  api = brandingAPI,
  convertLogo = prepareLogo,
  suggestion = null,
}) {
  const [state, setState] = useState(null),
    [draft, setDraft] = useState(emptyBranding),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const ownsBusy = useRef(false);
  const generation = useRef(0),
    onBusyRef = useRef(onBusy),
    suggestionRef = useRef(suggestion);
  onBusyRef.current = onBusy;
  suggestionRef.current = suggestion;
  function changeBusy(value) {
    ownsBusy.current = value;
    setBusy(value);
    onBusyRef.current(value);
  }
  useEffect(() => {
    const id = ++generation.current;
    setState(null);
    setDraft(emptyBranding());
    setError("");
    setNotice("");
    setBusy(false);
    if (connected)
      api()
        .then((data) => {
          if (data.account && data.account !== account)
            throw new Error(
              "Your Google account changed. Reopen Account before editing branding.",
            );
          if (generation.current === id) {
            setState(data);
            // Unsaved branding starts from the setup assistant's answers.
            const suggested = !data.version && suggestionRef.current;
            setDraft(
              suggested
                ? {
                    ...data.branding,
                    name: data.branding.name || suggested.name,
                    website: data.branding.website || suggested.website,
                    logo: data.branding.logo || suggested.logo,
                    shape: data.branding.logo
                      ? data.branding.shape
                      : suggested.shape,
                  }
                : data.branding,
            );
            if (suggested && data.available)
              setNotice(
                "Filled in from your setup assistant answers. Review, then save to show them to clients.",
              );
          }
        })
        .catch((e) => {
          if (generation.current === id) setError(e.message);
        });
    return () => {
      generation.current++;
      if (ownsBusy.current) {
        ownsBusy.current = false;
        onBusyRef.current(false);
      }
    };
  }, [connected, account, attempt, api]);
  const locked = busy || disabled || !state?.available;
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const id = generation.current;
    changeBusy(true);
    setError("");
    setNotice("");
    try {
      const logo = await convertLogo(file);
      if (generation.current === id) setDraft((old) => ({ ...old, logo }));
    } catch (e) {
      if (generation.current === id) setError(e.message);
    } finally {
      if (generation.current === id) {
        changeBusy(false);
      }
    }
  }
  async function save(event) {
    event.preventDefault();
    const id = generation.current;
    changeBusy(true);
    setError("");
    setNotice("");
    try {
      const branding = validateBranding(draft),
        result = await api({ branding, version: state.version }, state.subject);
      if (generation.current === id) {
        setState(result);
        setDraft(result.branding);
        setNotice(
          "Business branding saved. Your client links keep the same recipient and show these details when opened again.",
        );
      }
    } catch (e) {
      if (generation.current === id) setError(e.message);
    } finally {
      if (generation.current === id) {
        changeBusy(false);
      }
    }
  }
  return (
    <section className="branding-settings" aria-labelledby="branding-title">
      <h2 id="branding-title">Your business branding</h2>
      <p>
        Clients see these details on your StreamLion request pages. Requests
        belong to the provider who created the link. A service template never
        changes who receives them.
      </p>
      {!connected ? (
        <p>Sign in to Google to save your business name, logo and website.</p>
      ) : (
        <>
          {!state && !error && <p role="status">Loading business branding…</p>}
          {state && !state.available && (
            <p>
              Branding updates await activation. Your existing forms are kept.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {!state && error && (
            <button type="button" onClick={() => setAttempt((v) => v + 1)}>
              Retry branding load
            </button>
          )}
          {state && (
            <form onSubmit={save}>
              <label>
                Business name clients will see
                <input
                  required
                  maxLength={100}
                  value={draft.name}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Business website (optional)
                <input
                  type="url"
                  placeholder="https://your-business.com"
                  maxLength={500}
                  value={draft.website}
                  disabled={locked}
                  onChange={(e) =>
                    setDraft({ ...draft, website: e.target.value })
                  }
                />
              </label>
              <label>
                Upload your logo (optional)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={locked}
                  onChange={upload}
                />
              </label>
              <p>
                PNG, JPEG or WebP, up to 5 MB. StreamLion resizes the image on
                this device and removes its original metadata before saving.
                Your logo and website are visible to people with your client
                links.
              </p>
              <label>
                Logo display shape
                <select
                  value={draft.shape}
                  disabled={locked}
                  onChange={(e) =>
                    setDraft({ ...draft, shape: e.target.value })
                  }
                >
                  <option value="rounded">Rounded square</option>
                  <option value="square">Square</option>
                  <option value="rectangle">Rectangle</option>
                </select>
              </label>
              <p>Client preview · unsaved changes stay here until you save.</p>
              <ProviderBrand
                branding={{
                  ...draft,
                  website: (() => {
                    try {
                      return validateBranding({
                        ...draft,
                        name: draft.name || "Preview",
                      }).website;
                    } catch {
                      return "";
                    }
                  })(),
                }}
                recipient
              />
              <div className="branding-actions">
                <button disabled={locked}>
                  {busy ? "Saving branding…" : "Save business branding"}
                </button>
                {draft.logo && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setDraft({ ...draft, logo: "" })}
                  >
                    Remove logo
                  </button>
                )}
              </div>
            </form>
          )}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}
