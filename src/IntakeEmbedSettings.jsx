import React, { useState } from "react";

const escapeAttribute = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function intakeEmbedSnippets(embedId, publicUrl) {
  const origin = new URL(publicUrl).origin;
  const embedUrl = origin + "/api/intake-embed/" + embedId;
  const standalone = escapeAttribute(embedUrl);
  const inline = [
    `<iframe src="${embedUrl}" title="Project request" loading="lazy"`,
    '  referrerpolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"',
    '  style="width:100%;height:740px;border:0"></iframe>',
    `<p><a href="${standalone}" target="_blank" rel="noopener noreferrer">Open the form directly</a></p>`,
  ].join("\n");
  const modal = [
    `<a href="${standalone}" data-streamlion-intake="${embedUrl}">Start a project</a>`,
    `<script src="${origin}/intake-embed.js" defer></script>`,
  ].join("\n");
  return { inline, modal, previewUrl: embedUrl + "?preview=1" };
}

function CopySnippet({ label, code }) {
  const [message, setMessage] = useState("");
  return (
    <div className="coord-embed-snippet">
      <label>
        {label}
        <textarea
          readOnly
          rows={3}
          value={code}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <button
        type="button"
        className="coord-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setMessage("Copied.");
          } catch {
            setMessage("Select the code above and copy it.");
          }
        }}
      >
        Copy {label.toLowerCase()}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export default function IntakeEmbedSettings({ form, busy, update }) {
  const embed = form.websiteEmbed;
  const [origins, setOrigins] = useState(embed?.origins.join("\n") || "");
  const snippets =
    embed && form.active && intakeEmbedSnippets(embed.id, form.url);
  const websites = origins.split(/\s+/).filter(Boolean);
  async function save(enabled) {
    await update({
      formId: form.id,
      enabled,
      ...(enabled ? { origins: websites } : {}),
    });
  }
  return (
    <details className="coord-embed-settings">
      <summary>Embed on your website</summary>
      <p>
        Add the HTTPS addresses where the form will appear. Include both the www
        and non-www addresses if visitors use both.
      </p>
      <label>
        Website addresses
        <textarea
          rows={3}
          placeholder="https://studio.example"
          value={origins}
          onChange={(event) => setOrigins(event.target.value)}
        />
      </label>
      <div className="coord-actions">
        <button
          type="button"
          className="coord-secondary"
          disabled={busy || !form.active || !websites.length}
          onClick={() => save(true)}
        >
          {embed ? "Save website addresses" : "Enable website embed"}
        </button>
        {embed && (
          <button
            type="button"
            className="coord-secondary"
            disabled={busy}
            onClick={() => save(false)}
          >
            Disable embed
          </button>
        )}
      </div>
      {!form.active && <p>Make the public form available to use the embed.</p>}
      {snippets && (
        <>
          <p>
            After changing website addresses, replace the code on your site.
          </p>
          <a
            href={snippets.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Preview intake
          </a>
          <CopySnippet label="Inline embed" code={snippets.inline} />
          <CopySnippet label="Popup button" code={snippets.modal} />
        </>
      )}
    </details>
  );
}
