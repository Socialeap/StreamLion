import assert from "node:assert/strict";

export async function navigateWorkspace(ui, page) {
  const { fireEvent, waitFor } = await import("@testing-library/react");
  const home = ui.queryByRole("button", { name: "Home", exact: true });
  if (home) {
    await waitFor(() => assert.equal(home.disabled, false));
    fireEvent.click(home);
  }
  const action = await ui.findByRole("button", { name: page, exact: true });
  await waitFor(() => assert.equal(action.disabled, false));
  fireEvent.click(action);
}

// Existing workspace tests enter through the same explicit choice as a user.
export async function enterWorkspace(ui) {
  const { fireEvent, waitFor, act } = await import("@testing-library/react");
  // These tests exercise pilot workspace behavior, not the external license API.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) =>
    url === "/api/purchase/status"
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              enabled: true,
              required: false,
              purchased: false,
            }),
          ),
        )
      : originalFetch(url, options);
  let action;
  await waitFor(
    () => {
      action =
        ui.queryByRole("button", { name: "Open Projects", exact: true }) ||
        ui.queryByRole("button", {
          name: "Open saved workspace",
          exact: true,
        }) ||
        ui.queryByRole("button", {
          name: "Continue on this device",
          exact: true,
        });
      assert(
        action && !action.disabled,
        "Wait for the saved-session check before choosing a workspace",
      );
    },
    { timeout: 5000 },
  );
  await act(async () => {
    fireEvent.click(action);
  });
}
