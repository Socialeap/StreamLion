// Small, dependency-free launcher. A normal link remains usable without it.
(() => {
  const script = document.currentScript;
  if (
    !script ||
    typeof HTMLDialogElement === "undefined" ||
    typeof HTMLDialogElement.prototype.showModal !== "function"
  )
    return;
  const serviceOrigin = new URL(script.src).origin;
  const activate = (event) => {
    if (
      !(event.target instanceof Element) ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const button = event.target.closest("a[data-streamlion-intake]");
    if (!button) return;
    let src;
    try {
      src = new URL(button.dataset.streamlionIntake);
    } catch {
      return;
    }
    if (
      src.origin !== serviceOrigin ||
      !/^\/api\/intake-embed\/[A-Za-z0-9_-]{43}$/.test(src.pathname) ||
      src.search ||
      src.hash
    )
      return;

    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Start a project");
    Object.assign(dialog.style, {
      width: "min(48rem, 100% - 1rem)",
      maxWidth: "none",
      maxHeight: "none",
      padding: ".75rem",
      border: "1px solid #abb8b2",
      borderRadius: ".75rem",
      boxSizing: "border-box",
    });
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: ".5rem 1rem",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: ".5rem",
    });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.autofocus = true;
    close.style.minHeight = "44px";
    const direct = document.createElement("a");
    direct.href = button.href;
    direct.target = "_blank";
    direct.rel = "noopener noreferrer";
    direct.textContent = "Open form in a new tab";
    header.append(close, direct);
    const frame = document.createElement("iframe");
    frame.title = "Project request";
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute(
      "sandbox",
      "allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    Object.assign(frame.style, {
      display: "block",
      width: "100%",
      height: "min(45rem, 100dvh - 5.5rem)",
      border: "0",
    });
    const onMessage = (message) => {
      if (
        message.origin === serviceOrigin &&
        message.source === frame.contentWindow &&
        message.data?.type === "streamlion:intake-close"
      )
        dialog.close();
    };
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener(
      "close",
      () => {
        window.removeEventListener("message", onMessage);
        dialog.remove();
        button.focus();
      },
      { once: true },
    );
    frame.src = src.href;
    dialog.append(header, frame);
    document.body.append(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.remove();
      return;
    }
    event.preventDefault();
    close.focus();
    window.addEventListener("message", onMessage);
  };

  // Providers may paste several buttons on the same page.
  if (!document.documentElement.hasAttribute("data-streamlion-launcher")) {
    document.documentElement.setAttribute("data-streamlion-launcher", "");
    document.addEventListener("click", activate);
  }
})();
