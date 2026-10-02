const reasons = {
  client_rejected:
    "Google rejected StreamLion's sign-in credentials. The app owner needs to check that the Cloudflare client secret belongs to the configured Google client.",
  grant_rejected:
    "Google could not accept this sign-in attempt. Start again from Connections; finish in the same tab without reloading the callback.",
  state_mismatch:
    "Another tab started a newer Google sign-in. Finish in that tab, or start again from Connections.",
  offline_access:
    "Google did not return permission to remember your connection. Try Connect Google again and approve access.",
  token_response:
    "Google returned an incomplete sign-in response. Try again and approve the requested Drive access.",
  token_exchange:
    "StreamLion could not complete the sign-in exchange with Google. Try again; if this repeats, contact support with code token_exchange.",
  account_check:
    "StreamLion could not verify your Google account. Try again; if this repeats, contact support with code account_check.",
  session_save:
    "StreamLion could not save your Google connection. Contact support with code session_save.",
};

export function googleSignInFailure(result, reason) {
  const message =
    result === "cancelled"
      ? "Google sign-in was cancelled. Try again in Connections."
      : Object.hasOwn(reasons, reason)
        ? reasons[reason]
        : "Google sign-in was not completed. Try again in Connections.";
  return message + " Your drafts are preserved.";
}
