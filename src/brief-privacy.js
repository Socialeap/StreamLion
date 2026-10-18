// Runs without an AI service. Detection assists review; it is not proof of anonymity.
const reference = /SLP_\d+_/g;
const secret =
  /\b(?:password|passcode|door\s*code|entry\s*code|access\s*code|lockbox\s*code|alarm\s*code|pin|social security(?: number)?|ssn|credit card(?: number)?)\b[ \t]*(?::|=|#|\bis\b)?[ \t]*[^\r\n]+|\bsk-[A-Za-z0-9_-]{12,}|\bBearer[ \t]+\S+/gi;
const email = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phone =
  /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)/g;
const address =
  /\b\d{1,6}[ \t]+(?:[\p{L}\d.'-]+[ \t]+){1,6}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct)\b(?:[ \t]+(?:Apt|Suite|Unit)[ .#\t]*[\w-]+)?/giu;
const url = /https?:\/\/[^\s<>"']+/gi;
const knownKeys =
  /^(?:requesterName|requesterEmail|contact[12](?:Name|Phone)|providerName|providerEmail|companyName|address|address2|postal|reference)$/;
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
  const spans = [];
  const collect = (pattern, kind, group = 0) => {
    for (const match of source.matchAll(pattern)) {
      const value = match[group];
      const start = match.index + (group ? match[0].indexOf(value) : 0);
      spans.push({ start, end: start + value.length, value, kind });
    }
  };
  collect(secret, "secret");
  collect(email, "email");
  collect(phone, "phone");
  collect(url, "url");
  collect(address, "address");
  collect(
    /(?:^|\n)[ \t]*(?:Client|Contact|Requested by|Provider|Name|From|To)[ \t]*:[ \t]*([\p{L}][\p{L} .'’-]{2,70})(?=[<\n\r]|$)/giu,
    "name",
    1,
  );
  const phrases = [
    ...Object.entries(fields)
      .filter(
        ([key, value]) => knownKeys.test(key) && typeof value === "string",
      )
      .map(([, value]) => value),
    ...extra,
    // Once a literal has been discovered, hide unlabeled repetitions too.
    ...spans.filter((s) => s.kind !== "secret").map((s) => s.value),
  ];
  for (const value of phrases) {
    if (typeof value !== "string" || !value.trim()) continue;
    const phrase = value.trim();
    if (phrase.length < 2 || phrase.length > 500)
      throw new Error("Mark a private phrase between 2 and 500 characters.");
    collect(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escape(phrase)}(?![\\p{L}\\p{N}])`,
        "giu",
      ),
      "selected",
    );
  }
  // Secrets take precedence; overlapping matches never expose a partial private value.
  const selected = [];
  for (const span of spans.sort(
    (a, b) =>
      (a.kind === "secret" ? -1 : 0) - (b.kind === "secret" ? -1 : 0) ||
      b.value.length - a.value.length,
  )) {
    if (!selected.some((s) => span.start < s.end && span.end > s.start))
      selected.push(span);
  }
  selected.sort((a, b) => a.start - b.start);
  const entries = [];
  let text = "",
    cursor = 0,
    removedSecrets = 0;
  for (const span of selected) {
    text += source.slice(cursor, span.start);
    if (span.kind === "secret") {
      text += "[PRIVATE_ACCESS_REMOVED]";
      removedSecrets++;
    } else {
      let entry = entries.find(
        (e) =>
          e.value === span.value ||
          ((e.kind === "name" || span.kind === "name") &&
            e.value.toLocaleLowerCase() === span.value.toLocaleLowerCase()),
      );
      if (!entry) {
        entry = {
          token: `SLP_${entries.length + 1}_`,
          value: span.value,
          kind: span.kind,
        };
        entries.push(entry);
      }
      text += entry.token;
    }
    cursor = span.end;
  }
  text += source.slice(cursor);
  const value = {
    text,
    sourceName: "Project brief",
    privacy: { version: 1, entries },
    removedSecrets,
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
