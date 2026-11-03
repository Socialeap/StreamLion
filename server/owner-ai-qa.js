import { ownerWorkspaceQa } from "./owner-core-qa.js";

// This is a separate, short-lived authorization for one synthetic project.
// It grants neither a purchase nor access to any other paid feature.
export async function ownerAiQa(env, session, now = Date.now()) {
  if (
    env.STREAMLION_CHECKOUT_MODE !== "paused" ||
    env.ENABLE_FREE_PILOT === "true" ||
    !env.OPENAI_API_KEY ||
    !env.GOOGLE_SESSIONS ||
    typeof env.STREAMLION_OWNER_AI_QA !== "string" ||
    env.STREAMLION_OWNER_AI_QA.length > 2048
  )
    return null;
  try {
    const grant = JSON.parse(env.STREAMLION_OWNER_AI_QA);
    if (
      grant?.version !== 1 ||
      grant.scope !== "synthetic-text-ai" ||
      grant.subject !== session?.google_subject ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(grant.subject || "") ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(grant.workbookId || "") ||
      grant.workbookId !== session.workbook_id ||
      !/^[\w-]{1,100}$/.test(grant.projectId || "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        grant.requestId || "",
      ) ||
      !Number.isSafeInteger(grant.issuedAt) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.issuedAt <= 0 ||
      grant.issuedAt > now ||
      grant.expiresAt <= now ||
      grant.expiresAt <= grant.issuedAt ||
      grant.expiresAt - grant.issuedAt > 30 * 60 * 1000
    )
      return null;
    const workspace = await ownerWorkspaceQa(env, session, now);
    return workspace && grant.expiresAt <= workspace.expiresAt ? grant : null;
  } catch {
    return null;
  }
}
