import { filterPrivateTexts, privatePatterns } from "./privacy-filter.js";
// Runs without an AI service. Detection assists review; it is not proof of anonymity.
const reference = /SLP_\d+_/g;
const [secret, email, phone, url, address] = privatePatterns;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function filterBrief(source, fields = {}, extra = []) {
  if (
    typeof source !== "string" ||
    source.length > 6000 ||
    /SLP_/i.test(source)
  )
    throw new Error(
      "Use up to 6,000 characters without reserved SLP_ references.",
    );
  const filtered = filterPrivateTexts([source], {
    fields,
    extra,
    maxChars: 6000,
  });
  const value = {
    text: filtered.texts[0],
    sourceName: "Project brief",
    privacy: filtered.privacy,
    removedSecrets: filtered.removedSecrets,
  };
  validatePrivateBrief(value);
  return value;
}

export function assertMaskedText(text, privacy) {
  const visible = text
    .replace(reference, "")
    .replaceAll("[PRIVATE_ACCESS_REMOVED]", "");
  if (
    privacy.entries.some((e) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escape(e.value)}(?![\\p{L}\\p{N}])`,
        "iu",
      ).test(visible),
    )
  )
    throw new Error("A hidden detail reappeared in the filtered text.");
}

export function validatePrivateBrief(input) {
  const privacy = input?.privacy;
  if (
    !privacy ||
    privacy.version !== 1 ||
    !Array.isArray(privacy.entries) ||
    privacy.entries.length > 100 ||
    typeof input.text !== "string" ||
    !input.text.trim() ||
    input.text.length > 16000 ||
    input.sourceName !== "Project brief" ||
    JSON.stringify(privacy).length > 18000
  )
    throw new Error("Review the privacy preview before preparing this brief.");
  const seen = new Set();
  for (const [index, e] of privacy.entries.entries()) {
    if (
      !e ||
      Object.keys(e).sort().join() !== "kind,token,value" ||
      e.token !== `SLP_${index + 1}_` ||
      seen.has(e.token) ||
      typeof e.value !== "string" ||
      !e.value.trim() ||
      e.value.length > 500 ||
      /SLP_|PRIVATE_ACCESS_REMOVED/i.test(e.value) ||
      !["email", "phone", "url", "address", "name", "selected"].includes(
        e.kind,
      ) ||
      !input.text.includes(e.token)
    )
      throw new Error(
        "The private references could not be checked. Review the preview again.",
      );
    seen.add(e.token);
  }
  for (const token of input.text.match(reference) || [])
    if (!seen.has(token)) throw new Error("Unknown private reference.");
  const withoutTokens = input.text.replace(reference, "");
  assertMaskedText(input.text, privacy);
  const restoredLength = input.text.replace(
    reference,
    (token) => privacy.entries.find((e) => e.token === token).value,
  ).length;
  if (restoredLength > 6000)
    throw new Error(
      "Use up to 6,000 characters before hiding private details.",
    );
  if (
    /SLP_/i.test(withoutTokens) ||
    [secret, email, phone, url, address].some((p) =>
      new RegExp(p.source, p.flags).test(withoutTokens),
    )
  )
    throw new Error(
      "Some private details remain. Review and hide them before preparing.",
    );
  return privacy;
}

// Restore only values belonging to this request; never accept a model-created reference.
export function restoreBrief(project, privacy) {
  const entries = new Map(privacy.entries.map((e) => [e.token, e.value]));
  const fields = Object.fromEntries(
    Object.entries(project.fields).map(([key, value]) => {
      const replaced = value.replace(reference, (token) => {
        if (!entries.has(token)) throw new Error("Unknown private reference.");
        return entries.get(token);
      });
      if (/SLP_/i.test(replaced))
        throw new Error("Unrecognized private reference.");
      return [
        key,
        replaced.replaceAll(
          "[PRIVATE_ACCESS_REMOVED]",
          "[Access details excluded from AI preparation]",
        ),
      ];
    }),
  );
  return { ...project, fields };
}
