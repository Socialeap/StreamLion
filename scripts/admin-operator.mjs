// PREPARATION ONLY. This script never connects to Cloudflare or executes SQL.
import { fileURLToPath } from "node:url";
const email = "shakoure@transcendencemedia.com";
export function adminOperatorPlan({
  action,
  mode,
  subject,
  priorSubject,
  sha,
}) {
  if (
    !["bootstrap", "recover"].includes(action) ||
    !["test", "live"].includes(mode) ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(subject || "") ||
    !/^[a-f0-9]{40}$/.test(sha || "") ||
    (action === "recover" &&
      (!/^[A-Za-z0-9_-]{1,255}$/.test(priorSubject || "") ||
        priorSubject === subject))
  )
    throw Error(
      "Provide action, exact mode, verified Google subject(s), and approved merged 40-character main SHA.",
    );
  const id = crypto.randomUUID();
  const statements = [
    {
      sql: "INSERT INTO streamlion_admin_operator_requests_v1 VALUES(?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))",
      params: [id, action, mode, subject, priorSubject || null, sha],
    },
  ];
  return {
    execute: false,
    action,
    mode,
    mainSha: sha,
    requires:
      "Explicit owner authorization, exact-schema preflight and independent operator recovery access. The one insertion is guarded, applied and audited atomically by the committed database triggers.",
    stopIf:
      "Any statement fails or the exact operator receipt cannot be verified. A same-payload retry may return zero inserted rows only when its matching immutable receipt already exists.",
    statements,
    verify: {
      sql: "SELECT id,mode,target,action,reason FROM streamlion_admin_audit_v1 WHERE id=?",
      params: ["operator:" + id],
    },
    grantsEnabled: false,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        adminOperatorPlan({
          action: process.argv[2],
          mode: process.argv[3],
          subject: process.argv[4],
          sha: process.argv[5],
          priorSubject: process.argv[6],
        }),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
