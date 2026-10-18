import { filterPrivateTexts, privatePatterns } from "../src/privacy-filter.js";
import { assertMaskedText, restoreBrief } from "../src/brief-privacy.js";
import { AI_LIMITS, projectContext } from "./ai-providers.js";

// The authenticated Google read stays authoritative. Raw context and this map
// exist only for this request and are never passed to the model or the ledger.
export function privateAIInput(question, project, notes) {
  const data = JSON.parse(projectContext(project, notes));
  const sources = [question],
    secrets = [];
  const secretKey =
    /^(?:accessInstructions|password|passcode|pin|doorCode|entryCode|accessCode|lockboxCode|alarmCode|accessToken|refreshToken|credentials)$/i;
  const collect = (value, key = "") => {
    if (secretKey.test(key)) {
      if (typeof value === "string" && value.trim())
        secrets.push(value, ...(value.match(/\b\d{3,12}\b/g) || []));
      return "[PRIVATE_ACCESS_REMOVED]";
    }
    if (typeof value === "string") {
      sources.push(value);
      return { index: sources.length - 1 };
    }
    if (Array.isArray(value)) return value.map((v) => collect(v));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, collect(v, k)]),
      );
    return value;
  };
  const template = collect(data);
  const filtered = filterPrivateTexts(sources, {
    fields: project,
    secrets,
    repeatSecrets: true,
    extra: [project.title].filter(Boolean),
    maxChars: AI_LIMITS.contextBytes + 500,
  });
  for (const text of filtered.texts) {
    assertMaskedText(text, filtered.privacy);
    const visible = text
      .replace(/SLP_\d+_/g, "")
      .replaceAll("[PRIVATE_ACCESS_REMOVED]", "");
    if (
      privatePatterns.some((pattern) =>
        new RegExp(pattern.source, pattern.flags).test(visible),
      )
    )
      throw new Error("Private details remain in AI input.");
  }
  const fill = (value) => {
    if (value && typeof value === "object" && Object.hasOwn(value, "index"))
      return filtered.texts[value.index];
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, fill(v)]),
      );
    return value;
  };
  const context = JSON.stringify(fill(template));
  if (
    new TextEncoder().encode(context).length > AI_LIMITS.contextBytes ||
    filtered.texts[0].length > 2000
  )
    throw new Error("Private AI input is too large.");
  return { question: filtered.texts[0], context, privacy: filtered.privacy };
}

export function restoreAIAnswer(answer, privacy) {
  if (
    typeof answer !== "string" ||
    !answer.trim() ||
    answer.length > AI_LIMITS.answerChars
  )
    throw new Error("Invalid private answer.");
  assertMaskedText(answer, privacy);
  const visible = answer
    .replace(/(?<![\p{L}\p{N}_])SLP_\d+_(?![\p{L}\p{N}_])/gu, "")
    .replaceAll("[PRIVATE_ACCESS_REMOVED]", "");
  if (/SLP_/i.test(visible)) throw new Error("Malformed private reference.");
  const detected = filterPrivateTexts([visible], {
    maxChars: AI_LIMITS.answerChars,
  });
  if (detected.privacy.entries.length || detected.removedSecrets)
    throw new Error("Unverified private details in answer.");
  const restored = restoreBrief({ fields: { answer } }, privacy).fields.answer;
  if (restored.length > AI_LIMITS.answerChars)
    throw new Error("Restored answer is too large.");
  return restored;
}
