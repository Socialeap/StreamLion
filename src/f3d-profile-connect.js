import { fetchRead } from "./network.js";
export async function f3dProfileAPI(body, subject, signal) {
  const response = await fetchRead("/api/f3d-profile", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
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
    throw new Error(
      result.error || "Could not reach your F|3D profile connection.",
    );
  return result;
}
export function awaitProfileApproval(popup, nonce, signal, host = window) {
  return new Promise((resolve, reject) => {
    let timeout, poll;
    const cleanup = () => {
      host.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
      clearInterval(poll);
    };
    const fail = (message) => {
      cleanup();
      reject(new Error(message));
    };
    const abort = () => fail("Profile connection cancelled.");
    function receive(event) {
      if (
        event.origin !== "https://www.frontiers3d.com" ||
        event.source !== popup
      )
        return;
      if (event.data?.type === "f3d-profile-ready")
        popup.postMessage(
          { type: "streamlion-profile-request", nonce },
          "https://www.frontiers3d.com",
        );
      if (
        event.data?.type === "f3d-profile-approved" &&
        event.data.nonce === nonce &&
        typeof event.data.assertion === "string" &&
        event.data.assertion.length <= 16000
      ) {
        cleanup();
        resolve(event.data.assertion);
      }
    }
    if (signal.aborted) {
      abort();
      return;
    }
    host.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(
      () => fail("Profile connection timed out. Start again."),
      600000,
    );
    poll = setInterval(() => {
      if (popup.closed)
        fail("The F|3D window was closed. Start again when ready.");
    }, 1000);
  });
}
