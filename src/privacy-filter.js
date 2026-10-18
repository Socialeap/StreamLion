// Runs without an AI service. Detection assists review; it is not proof of anonymity.
const secret =
  /\b(?:password|passcode|door\s*code|entry\s*code|access\s*code|lockbox\s*code|alarm\s*code|social security(?: number)?|ssn|credit card(?: number)?)\b[ \t]*(?::|=|#|\bis\b)?[ \t]*[^\r\n]+|\bpin\b[ \t]*(?::|=|#|\bis\b)[ \t]*[^\r\n]+|\bsk-[A-Za-z0-9_-]{12,}|\bBearer[ \t]+\S+/gi;
const email =
  /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/gi;
const phone =
  /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)/g;
const address =
  /\b\d{1,6}[ \t]+(?:[\p{L}\d.'-]+[ \t]+){1,6}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct)\b(?:[ \t]+(?:Apt|Suite|Unit)[ .#\t]*[\w-]+)?/giu;
// Stop at a Markdown label/target boundary, without excluding IPv6 brackets.
const url = /https?:\/\/(?:(?!\]\()[^\s<>"'])+/gi;
const knownKeys =
  /^(?:requesterName|requesterEmail|contact[12](?:Name|Phone)|providerName|providerEmail|companyName|address|address2|postal|reference)$/;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function trimProseFromUrl(value) {
  let previous;
  do {
    previous = value;
    value = value.replace(/[.,;:!?]+$/, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ]) {
      if (
        value.endsWith(close) &&
        value.split(close).length > value.split(open).length
      )
        value = value.slice(0, -1);
    }
  } while (value !== previous);
  return value;
}

export const privatePatterns = [secret, email, phone, url, address];

// One bounded request-local map across separate strings. Never scan serialized
// JSON: a credential must not consume other fields or break the JSON structure.
export function filterPrivateTexts(
  sources,
  {
    fields = {},
    extra = [],
    secrets = [],
    repeatSecrets = false,
    maxChars = 6000,
  } = {},
) {
  if (
    !Array.isArray(sources) ||
    sources.length > 512 ||
    sources.some((s) => typeof s !== "string" || /SLP_/i.test(s)) ||
    sources.reduce((n, s) => n + s.length, 0) > maxChars
  )
    throw new Error("Private text cannot be filtered safely.");
  let matches = 0;
  const blocks = sources.map((source) => ({ source, spans: [] }));
  const collect = (block, pattern, kind, group = 0) => {
    for (const match of block.source.matchAll(pattern)) {
      if (++matches > 1000)
        throw new Error("Too many private details to filter safely.");
      const value =
        kind === "url" ? trimProseFromUrl(match[group]) : match[group];
      const start = match.index + (group ? match[0].indexOf(value) : 0);
      block.spans.push({ start, end: start + value.length, value, kind });
    }
  };
  for (const block of blocks) {
    for (const [pattern, kind] of [
      [secret, "secret"],
      [email, "email"],
      [phone, "phone"],
      [url, "url"],
      [address, "address"],
    ])
      collect(block, pattern, kind);
    collect(
      block,
      /(?:^|\n)[ \t]*(?:Client|Contact|Requested by|Provider|Name|From|To)[ \t]*:[ \t]*([\p{L}][\p{L} .'’-]{2,70})(?=[<\n\r]|$)/giu,
      "name",
      1,
    );
  }
  // A credential recognized in one field must also be removed when repeated
  // without its label elsewhere. These values never enter the replacement map.
  const hidden = new Set(
    secrets
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => s.trim()),
  );
  if (repeatSecrets)
    for (const block of blocks)
      for (const span of block.spans.filter((s) => s.kind === "secret")) {
        const part = span.value.match(
          /^(?:(?:password|passcode|door\s*code|entry\s*code|access\s*code|lockbox\s*code|alarm\s*code|social security(?: number)?|ssn|credit card(?: number)?|pin)\b[ \t]*(?::|=|#|\bis\b)?[ \t]*|Bearer[ \t]+)([^\r\n]+)/i,
        );
        const value = (part?.[1] || span.value).trim();
        // Retain the earlier single-token protection for credentials followed
        // by explanatory prose; full phrases take precedence on overlap below.
        const firstToken = (value.match(/^\S+/)?.[0] || "").replace(
          /[.,;!?]+$/,
          "",
        );
        if (firstToken) hidden.add(firstToken);
        // Keep the exact credential, including meaningful punctuation. Also
        // recognize presentation quotes/prose punctuation on an unquoted repeat.
        for (const candidate of [value, value.replace(/[.,;!?]+$/, "")]) {
          if (!candidate) continue;
          hidden.add(candidate);
          const closing = { '"': '"', "'": "'", "“": "”", "‘": "’" }[
            candidate[0]
          ];
          if (closing && candidate.endsWith(closing)) {
            const unquoted = candidate.slice(1, -1).trim();
            if (unquoted) hidden.add(unquoted);
            const withoutProse = unquoted.replace(/[.,;!?]+$/, "");
            if (withoutProse) hidden.add(withoutProse);
          }
        }
      }
  if (hidden.size > 100) throw new Error("Too many secrets to filter safely.");
  for (const value of hidden) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    for (const block of blocks) collect(block, pattern, "secret");
  }
  const names = new Map(
    [
      ...Object.entries(fields)
        .filter(
          ([key, value]) =>
            /^(?:requesterName|contact[12]Name|providerName|companyName)$/.test(
              key,
            ) &&
            typeof value === "string" &&
            value.trim(),
        )
        .map(([, value]) => [value.trim().toLocaleLowerCase(), value.trim()]),
      ...blocks.flatMap((b) =>
        b.spans
          .filter((s) => s.kind === "name")
          .map((s) => [s.value.toLocaleLowerCase(), s.value]),
      ),
    ].reverse(),
  );
  const phrases = new Set(
    [
      ...Object.entries(fields)
        .filter(
          ([key, value]) => knownKeys.test(key) && typeof value === "string",
        )
        .map(([, value]) => value),
      ...extra,
      ...blocks.flatMap((b) =>
        b.spans.filter((s) => s.kind !== "secret").map((s) => s.value),
      ),
    ]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim()),
  );
  if (phrases.size > 100)
    throw new Error("Too many private details to filter safely.");
  for (const phrase of phrases) {
    if (phrase.length < 2 || phrase.length > 500)
      throw new Error("Mark a private phrase between 2 and 500 characters.");
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(phrase)}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    for (const block of blocks)
      collect(
        block,
        pattern,
        names.has(phrase.toLocaleLowerCase()) ? "name" : "selected",
      );
  }
  const entries = [];
  let removedSecrets = 0;
  const texts = blocks.map(({ source, spans }) => {
    const selected = [];
    for (const span of spans.sort(
      (a, b) =>
        (a.kind === "secret" ? -1 : 0) - (b.kind === "secret" ? -1 : 0) ||
        b.value.length - a.value.length,
    ))
      if (!selected.some((s) => span.start < s.end && span.end > s.start))
        selected.push(span);
    selected.sort((a, b) => a.start - b.start);
    let text = "",
      cursor = 0;
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
            value:
              span.kind === "name"
                ? names.get(span.value.toLocaleLowerCase()) || span.value
                : span.value,
            kind: span.kind,
          };
          entries.push(entry);
        }
        text += entry.token;
      }
      cursor = span.end;
    }
    return text + source.slice(cursor);
  });
  if (entries.length > 100 || JSON.stringify(entries).length > 18000)
    throw new Error("Private reference map is too large.");
  return { texts, privacy: { version: 1, entries }, removedSecrets };
}
