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
      className="account-status"
      aria-label={`Account: ${label}. ${detail}`}
      onClick={onOpen}
      disabled={disabled}
    >
      <UserRound size={20} aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}
