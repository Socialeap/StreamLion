// Offline preparation only. Input must come from the existing verified owner
// enrollment, never a browser-entered email or arbitrary account selection.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
const { values } = parseArgs({
  options: { "identity-file": { type: "string" }, out: { type: "string" } },
});
try {
  if (!values["identity-file"] || !values.out)
    throw Error("Provide --identity-file and a new --out path.");
  const identity = JSON.parse(await readFile(values["identity-file"], "utf8"));
  if (
    identity.mode !== "live" ||
    identity.enabled !== 1 ||
    identity.policy_enabled !== 1 ||
    identity.email !== "shakoure@transcendencemedia.com" ||
    typeof identity.google_subject !== "string" ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(identity.google_subject)
  )
    throw Error(
      "Expected the existing enabled verified production owner enrollment; STOP.",
    );
  const issuedAt = Date.now();
  const grant = {
    version: 1,
    scope: "google-workspace",
    mode: "live",
    origin: "https://streamlion.transcendencemedia.com",
    subject: identity.google_subject,
    issuedAt,
    expiresAt: issuedAt + 7200000,
    reason: "Owner-only production Google workspace QA",
  };
  await writeFile(values.out, JSON.stringify(grant) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      prepared: true,
      subjectFingerprint: createHash("sha256")
        .update(identity.google_subject)
        .digest("hex")
        .slice(0, 16),
      scope: grant.scope,
      expiresAt: grant.expiresAt,
      activationPerformed: false,
    }),
  );
} catch (error) {
  console.error(
    error.code === "EEXIST"
      ? "Output already exists; no file overwritten."
      : error.message ===
            "Expected the existing enabled verified production owner enrollment; STOP." ||
          error.message === "Provide --identity-file and a new --out path."
        ? error.message
        : "QA preparation failed; no activation performed.",
  );
  process.exitCode = 1;
}
