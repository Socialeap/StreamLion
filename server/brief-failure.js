// Closed diagnostic vocabulary only. Never pass provider error text, source,
// credentials, account IDs or job IDs into a log or customer-facing error.
const messages = {
  request_size: "The preparation request exceeded the allowed size.",
  provider_auth: "The preparation service's access needs attention.",
  provider_request: "The preparation service rejected the request format.",
  provider_capacity:
    "The preparation service's rate or usage limit was reached.",
  provider_unavailable: "The preparation service is temporarily unavailable.",
  provider_timeout: "The preparation service did not finish in time.",
  invalid_response: "The preparation service returned an unreadable response.",
  incomplete_result: "The preparation service did not return a complete brief.",
  refused: "The preparation service could not prepare this brief.",
  invalid_project: "The prepared details did not pass the project checks.",
  qa_permission_changed: "Owner QA permission changed before processing.",
  processing_failed: "The prepared brief could not be processed safely.",
};

export class BriefFailure extends Error {
  constructor(code, status) {
    super(code);
    this.code = Object.hasOwn(messages, code) ? code : "processing_failed";
    if (Number.isInteger(status) && status >= 400 && status <= 599)
      this.status = status;
  }
}

export function briefFailure(error) {
  const code = error instanceof BriefFailure ? error.code : "processing_failed";
  const reference = crypto.randomUUID();
  console.warn(
    JSON.stringify({
      service: "streamlion",
      event: "brief_failure",
      code,
      reference,
      ...(error instanceof BriefFailure && error.status
        ? { status: error.status }
        : {}),
    }),
  );
  return {
    errorCode: code,
    reference,
    error: `${messages[code]} Reserved credits were returned; your draft is unchanged. Reference: ${reference}. Recover this attempt before starting anything else.`,
  };
}
