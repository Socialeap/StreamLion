import { UserRound } from "lucide-react";
export default function AccountStatus({
  checking,
  error,
  connected,
  account,
  bookId,
  verified,
  disabled,
  onOpen,
  accountLabel,
}) {
  let label = "Not signed in",
    detail = "Device only · not synced to Google";
  if (checking) {
    label = "Checking Google connection";
    detail = "Your device drafts stay here";
  } else if (error) {
    label = "Connection unavailable";
    detail = "Check Google connection · drafts kept";
  } else if (connected) {
    label = account || "Google connected";
    detail = verified
      ? "Google workbook connected"
      : bookId
        ? "Workbook needs refresh"
        : "Choose a workbook";
  } else if (bookId) {
    label = "Reconnect Google";
    detail = "Selected workbook · drafts kept";
  }
  return (
    <button
      className="profile-avatar"
      aria-label={accountLabel || `Account: ${label}. ${detail}`}
      title={accountLabel || `Account: ${label}. ${detail}`}
      onClick={onOpen}
      disabled={disabled}
    >
      {connected && account ? (
        <span className="profile-initial" aria-hidden="true">
          {account.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <UserRound size={21} aria-hidden="true" />
      )}
    </button>
  );
}
