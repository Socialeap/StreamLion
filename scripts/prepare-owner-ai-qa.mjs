// Offline only. Never print an identity, grant or credential to the terminal.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { OWNER_EMAIL } from "../server/admin-data.js";

const { values } = parseArgs({
  options: {
    "identity-file": { type: "string" },
    "workspace-file": { type: "string" },
    "workbook-id": { type: "string" },
    "project-id": { type: "string" },
    out: { type: "string" },
    minutes: { type: "string", default: "15" },
  },
});
try {
  const identity = JSON.parse(await readFile(values["identity-file"], "utf8"));
  const workspace = JSON.parse(
    await readFile(values["workspace-file"], "utf8"),
  );
  const now = Date.now(),
    minutes = Number(values.minutes),
    expiry = now + minutes * 60000;
  if (
    identity.mode !== "live" ||
    identity.enabled !== 1 ||
    identity.policy_enabled !== 1 ||
    identity.email !== OWNER_EMAIL ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(identity.google_subject || "") ||
    workspace.version !== 1 ||
    workspace.scope !== "google-workspace" ||
    workspace.mode !== "live" ||
    workspace.origin !== "https://streamlion.transcendencemedia.com" ||
    workspace.subject !== identity.google_subject ||
    !Number.isSafeInteger(workspace.issuedAt) ||
    !Number.isSafeInteger(workspace.expiresAt) ||
    workspace.issuedAt <= 0 ||
    workspace.issuedAt > now ||
    workspace.expiresAt - workspace.issuedAt > 72 * 3600000 ||
    typeof workspace.reason !== "string" ||
    !workspace.reason.trim() ||
    workspace.reason.length > 200 ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 30 ||
    expiry > workspace.expiresAt ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(values["workbook-id"] || "") ||
    !/^[\w-]{1,100}$/.test(values["project-id"] || "") ||
    !values.out
  )
    throw new Error(
      "Invalid or expired verified owner, workspace, project or duration; STOP.",
    );
  const grant = {
    version: 1,
    scope: "synthetic-text-ai",
    subject: identity.google_subject,
    workbookId: values["workbook-id"],
    projectId: values["project-id"],
    requestId: randomUUID(),
    issuedAt: now,
    expiresAt: expiry,
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
      expiresAt: expiry,
      maxAttempts: 1,
      activationPerformed: false,
    }),
  );
} catch (error) {
  console.error(
    error.code === "EEXIST"
      ? "Output exists; no file overwritten."
      : "Preparation failed; no activation performed. Verify the identity, workspace grant, project and duration.",
  );
  process.exitCode = 1;
}
