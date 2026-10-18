export default function BriefPrivacyNotice({ client = false }) {
  return (
    <details className="brief-privacy-notice">
      <summary>How brief preparation protects your information</summary>
      {client && (
        <p>
          Your request goes to your provider. The form and request assistant do
          not send your answers to OpenAI. Your provider may choose optional AI
          brief preparation when available.
        </p>
      )}
      <p>
        In-app brief preparation replaces detected names, contact details and
        addresses with labels on {client ? "your provider’s" : "your"} device.
        Detected passwords and access codes are left out. The person preparing
        the brief reviews the text and can hide more details before sending it
        to OpenAI.
      </p>
      <p>
        Filtering reduces what OpenAI sees, but can miss identifying details.
        StreamLion restores replaced details after processing so the brief
        remains useful. Removed access codes are not restored.
      </p>
      <p>
        Later AI questions and sharing with your own ChatGPT do not use this
        filter. Saved-detail lookup does not send questions to OpenAI. Manual
        brief entry is also available. Read the{" "}
        <a href="/api/privacy#brief-preparation">brief data-handling details</a>
        .
      </p>
    </details>
  );
}
