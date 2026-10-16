import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { fetchRead } from "./network.js";

const stages = [
  ["share", "Share", -0.31, -0.3],
  ["agree", "Agree", 0.31, -0.3],
  ["prepare", "Prepare", 0.39, 0.04],
  ["capture", "Capture", 0.27, 0.35],
  ["check", "Check", -0.27, 0.35],
  ["deliver", "Deliver", -0.39, 0.04],
];

export default function WelcomeScreen({
  ready,
  checking,
  connected,
  account,
  bookId,
  error,
  busy,
  animate = true,
  setup = "",
  onSetup,
  onProjects,
  onConnect,
  onDevice,
  onSignOut,
}) {
  const root = useRef(null);
  const canAnimate =
    animate &&
    typeof HTMLElement !== "undefined" &&
    typeof HTMLElement.prototype.animate === "function";
  const [motion, setMotion] = useState(canAnimate ? "pending" : "static");
  const [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  useEffect(() => {
    if (checking || connected) return;
    let current = true;
    const controller = new AbortController();
    setConfigLoading(true);
    fetchRead("/api/google-config", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (current)
          setConfig(
            value?.persistentEnabled === true && value?.clientId ? value : null,
          );
      })
      .catch(() => {
        if (current) setConfig(null);
      })
      .finally(() => {
        if (current) setConfigLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [checking, connected]);

  useEffect(() => {
    if (!canAnimate) return;
    const element = root.current;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const animations = [];
    let cancelled = false;
    const settle = () => {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
      setMotion("static");
    };
    if (media?.matches) {
      settle();
      return;
    }
    media?.addEventListener("change", settle);
    // Account controls remain usable during a slow mobile asset load.
    // A late font must never suppress the explanatory animation.
    const deadline = setTimeout(settle, 5000);
    const images = [...element.querySelectorAll("img")];
    const imageListeners = [];
    Promise.all(
      images.map((image) => {
        if (image.complete && image.naturalWidth) return Promise.resolve();
        if (image.decode) return image.decode().catch(() => {});
        return new Promise((resolve) => {
          const finish = () => {
            image.removeEventListener("load", finish);
            image.removeEventListener("error", finish);
            resolve();
          };
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          imageListeners.push(() => {
            image.removeEventListener("load", finish);
            image.removeEventListener("error", finish);
          });
        });
      }),
    ).then(() => {
      clearTimeout(deadline);
      if (cancelled) return;
      if (images.some((image) => !image.naturalWidth)) {
        settle();
        return;
      }
      setMotion("playing");
      const add = (target, frames, options) => {
        animations.push(target.animate(frames, { fill: "both", ...options }));
      };
      const easeOut = "cubic-bezier(.23,1,.32,1)";
      const easeInOut = "cubic-bezier(.77,0,.175,1)";
      const { width, height } = element
        .querySelector(".welcome-logo-stage")
        .getBoundingClientRect();
      const cables = element.querySelector(".welcome-cables");
      for (const [i, node] of [
        ...element.querySelectorAll(".welcome-node"),
      ].entries()) {
        const x = Number(node.dataset.x) * width,
          y = Number(node.dataset.y) * height;
        const wrap = document.createElement("div");
        wrap.className = "welcome-cable-wrap";
        wrap.style.width = `${Math.hypot(x, y)}px`;
        wrap.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
        const cable = document.createElement("span");
        cable.className = "welcome-cable";
        wrap.append(cable);
        cables.append(wrap);
        const outer = `translate(${x - 27}px,${y - 27}px)`;
        // Complete set visible at 395ms; hold it for 2.705s before pulling.
        const pull = 3100 + i * 20,
          duration = pull + 530;
        add(
          node,
          [
            { offset: 0, transform: `${outer} scale(.96)`, opacity: 0 },
            {
              offset: (i * 35) / duration,
              transform: `${outer} scale(.96)`,
              opacity: 0,
              easing: easeOut,
            },
            {
              offset: (i * 35 + 220) / duration,
              transform: `${outer} scale(1)`,
              opacity: 1,
            },
            {
              offset: pull / duration,
              transform: `${outer} scale(1)`,
              opacity: 1,
              easing: easeInOut,
            },
            {
              offset: 1,
              transform: "translate(-27px,-27px) scale(.25)",
              opacity: 0,
            },
          ],
          { duration },
        );
        const shoot = 260 + i * 35;
        add(
          cable,
          [
            {
              offset: 0,
              transform: "scaleX(.001)",
              transformOrigin: "100% 50%",
              opacity: 0,
            },
            {
              offset: shoot / duration,
              transform: "scaleX(.001)",
              transformOrigin: "100% 50%",
              opacity: 0,
              easing: easeOut,
            },
            {
              offset: (shoot + 250) / duration,
              transform: "scaleX(1)",
              transformOrigin: "100% 50%",
              opacity: 1,
            },
            {
              offset: pull / duration,
              transform: "scaleX(1)",
              transformOrigin: "0% 50%",
              opacity: 1,
              easing: easeInOut,
            },
            {
              offset: 1,
              transform: "scaleX(.001)",
              transformOrigin: "0% 50%",
              opacity: 0,
            },
          ],
          { duration },
        );
        add(node.querySelector("span"), [{ opacity: 1 }, { opacity: 0 }], {
          duration: 150,
          delay: pull,
          fill: "forwards",
        });
      }
      add(
        element.querySelector(".welcome-lion"),
        [
          { transform: "scale(.96)", opacity: 0.2 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 450, easing: easeOut },
      );
      add(
        element.querySelector("h1"),
        [
          { opacity: 0.15, transform: "translateY(7px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 350, delay: 180, easing: easeOut },
      );
      // Last pull ends at 3730ms. Tagline enters only after every icon is gone.
      add(
        element.querySelector(".welcome-tagline"),
        [
          { opacity: 0, transform: "translateY(5px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 300, delay: 3780, easing: easeOut },
      );
    });
    // Mobile browser bars resize height during cold startup and ordinary scroll.
    // Only a layout-width/orientation change invalidates the measured paths.
    const width = window.innerWidth;
    const resize = () => {
      if (window.innerWidth !== width) settle();
    };
    window.addEventListener("resize", resize);
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      imageListeners.forEach((remove) => remove());
      animations.forEach((animation) => animation.cancel());
      media?.removeEventListener("change", settle);
      window.removeEventListener("resize", resize);
      element.querySelector(".welcome-cables").replaceChildren();
    };
  }, []);

  const disabled = !ready || checking || busy;
  const oauthReady =
    !connected && !error && !disabled && !configLoading && !!config;
  const label = checking
    ? "Checking connection…"
    : error
      ? "Review connection"
      : connected
        ? "Open Projects"
        : bookId
          ? "Reconnect with Google"
          : "Sign in with Google";
  const action = connected && !error ? onProjects : onConnect;
  // A first visit leads with the setup assistant; Google stays one tap away.
  const guided = !!setup && !!onSetup && !connected && !error && !checking;
  const signIn = oauthReady ? (
    <a href="/api/google/start">Sign in with Google</a>
  ) : (
    <button disabled={disabled || configLoading} onClick={onConnect}>
      Sign in with Google
    </button>
  );
  return (
    <main
      className="welcome-screen"
      data-motion={motion}
      data-connected={connected}
      ref={root}
      aria-labelledby="welcome-brand"
    >
      <div className="welcome-composition">
        <div className="welcome-logo-stage" aria-hidden="true">
          <div className="welcome-cables" />
          {stages.map(([asset, title, x, y]) => (
            <div className="welcome-node" data-x={x} data-y={y} key={asset}>
              <img
                src={`/welcome/${asset}.webp`}
                alt=""
                width="54"
                height="54"
              />
              <span>{title}</span>
            </div>
          ))}
          <div className="welcome-lion-anchor">
            <svg
              viewBox="180 210 900 920"
              className="welcome-lion"
              focusable="false"
            >
              <defs>
                <filter
                  id="welcome-mint-palette"
                  colorInterpolationFilters="sRGB"
                >
                  <feColorMatrix
                    type="matrix"
                    values="0 0 0 0 .788235 0 0 0 0 .952941 0 0 0 0 .858824 0 0 0 1 0"
                  />
                </filter>
              </defs>
              <image
                href="/lion-mint-512.png"
                width="1254"
                height="1254"
                filter="url(#welcome-mint-palette)"
              />
            </svg>
          </div>
        </div>
        <h1 id="welcome-brand">StreamLion</h1>
        <p className="welcome-tagline">
          Condensing Capture Work
          <br />
          into an End-to-End Workflow
        </p>
      </div>
      <section className="welcome-account" aria-label="Your account">
        <div className="welcome-identity" aria-live="polite">
          {checking ? (
            <span role="status">Checking your saved connection…</span>
          ) : connected ? (
            <>
              <span className="welcome-caption">Welcome back</span>
              <span className="welcome-email">
                {account || "Google connected"}
              </span>
            </>
          ) : null}
        </div>
        {error && (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        )}
        {guided ? (
          <button
            className="welcome-primary"
            disabled={disabled}
            onClick={onSetup}
          >
            <span>{setup === "active" ? "Continue setup" : "Get started"}</span>
            <ArrowRight size={19} aria-hidden="true" />
          </button>
        ) : oauthReady ? (
          <a className="welcome-primary" href="/api/google/start">
            <span className="welcome-google" aria-hidden="true">
              G
            </span>
            <span>{label}</span>
            <ArrowRight size={19} aria-hidden="true" />
          </a>
        ) : (
          <button
            className="welcome-primary"
            disabled={disabled || (!connected && !error && configLoading)}
            onClick={action}
          >
            <span>{label}</span>
            <ArrowRight size={19} aria-hidden="true" />
          </button>
        )}
        <p className="welcome-secondary">
          {guided ? (
            <>
              <span>Already use StreamLion?</span>
              {signIn}
            </>
          ) : connected ? (
            <button disabled={disabled} onClick={onSignOut}>
              {busy ? "Signing out…" : "Sign out"}
            </button>
          ) : !checking && !error ? (
            <>
              <span>New to StreamLion?</span>
              {oauthReady ? (
                <a href="/api/google/start">Sign up</a>
              ) : (
                <button
                  disabled={disabled || configLoading}
                  onClick={onConnect}
                >
                  Sign up
                </button>
              )}
            </>
          ) : null}
        </p>
        <p className="welcome-note">
          {connected
            ? bookId
              ? "Your workspace is ready."
              : "Choose a workbook to finish setup."
            : "Your records. Your Google account."}
        </p>
        {(!connected || error) && (
          <button
            className="welcome-device"
            disabled={disabled}
            onClick={onDevice}
          >
            {connected ? "Open saved workspace" : "Continue on this device"}
          </button>
        )}
      </section>
      <footer className="welcome-footer">
        Share <i>·</i> Agree <i>·</i> Prepare <i>·</i> Capture <i>·</i> Check{" "}
        <i>·</i> Deliver
      </footer>
    </main>
  );
}
