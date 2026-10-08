import React, { useEffect, useState } from "react";
import { PROJECT_FIELDS } from "./project-schema.js";
import { CLIENT_FIELDS, REQUIRED_FIELDS } from "./client-permissions.js";
import {
  INTAKE_DEFAULT_FIELDS,
  INTAKE_PRESETS,
  validateIntakeConfig,
} from "./intake-templates.js";
import { stableJSON } from "./coordination-contract.js";

const blank = () => ({
  name: "",
  description: "",
  defaults: {},
  questions: [],
});
const fields = PROJECT_FIELDS.filter((field) => CLIENT_FIELDS.has(field.key));
const labels = Object.fromEntries(
  PROJECT_FIELDS.map((field) => [field.key, field.label]),
);
export default function IntakeTemplateSettings({
  templates,
  busy,
  save,
  recovering = false,
}) {
  const [selected, setSelected] = useState(""),
    [expectedVersion, setExpectedVersion] = useState(0);
  const [config, setConfig] = useState(blank),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [preset, setPreset] = useState("");
  const [newId, setNewId] = useState(() => "intake-" + crypto.randomUUID());
  const current = templates.find((template) => template.id === selected);
  const stale = current && current.revision + 1 !== expectedVersion;
  const dirty = !current || stableJSON(config) !== stableJSON(current.config);
  useEffect(() => {
    if (recovering) return;
    const recovered = templates.find(
      (t) =>
        t.id === (selected || newId) && t.revision + 1 === expectedVersion + 1,
    );
    if (!recovered) return;
    try {
      if (
        stableJSON(recovered.config) !==
        stableJSON(validateIntakeConfig(config))
      )
        return;
      setSelected(recovered.id);
      setExpectedVersion(recovered.revision + 1);
      setConfig(structuredClone(recovered.config));
      setNotice(
        `Service template version ${recovered.revision + 1} saved and verified in Google.`,
      );
    } catch {
      /* An incomplete edit is never replaced by a recovered save. */
    }
  }, [templates, recovering]);
  function load(template) {
    setSelected(template?.id || "");
    setExpectedVersion(template ? template.revision + 1 : 0);
    setConfig(template ? structuredClone(template.config) : blank());
    setPreset("");
    if (!template) setNewId("intake-" + crypto.randomUUID());
    setError("");
    setNotice("");
  }
  function question(index, patch) {
    setConfig({
      ...config,
      questions: config.questions.map((q, i) =>
        i === index ? { ...q, ...patch } : q,
      ),
    });
    setNotice("");
  }
  return (
    <details className="coord-card coord-template-settings">
      <summary>Services & intake templates</summary>
      <p>
        Save reusable service wording and questions in your Google workbook.
        Each new request keeps the selected version. Existing requests keep
        their original questions.
      </p>
      <label>
        Edit a saved service
        <select
          disabled={busy}
          value={selected}
          onChange={(e) => load(templates.find((t) => t.id === e.target.value))}
        >
          <option value="">New service template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.config.name} · version {t.revision + 1}
            </option>
          ))}
        </select>
      </label>
      {!selected && (
        <label>
          Starting questions
          <select
            disabled={busy}
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              setConfig(
                e.target.value === ""
                  ? blank()
                  : structuredClone(INTAKE_PRESETS[Number(e.target.value)]),
              );
              setError("");
              setNotice("");
            }}
          >
            <option value="">Start empty</option>
            {INTAKE_PRESETS.map((preset, i) => (
              <option key={preset.name} value={i}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {stale && (
        <p className="coord-alert">
          This service changed while you were editing. Your wording remains in
          this page.{" "}
          <button type="button" disabled={busy} onClick={() => load(current)}>
            Load the latest saved template
          </button>
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setNotice("");
          let checked;
          try {
            checked = validateIntakeConfig(config);
          } catch (failure) {
            setError(failure.message);
            return;
          }
          const id = selected || newId;
          const result = await save({
            templateId: id,
            expectedVersion,
            config: checked,
          });
          if (result) {
            setSelected(id);
            setExpectedVersion(expectedVersion + 1);
            setConfig(checked);
            setNotice(
              `Service template version ${expectedVersion + 1} saved and verified in Google.`,
            );
          }
        }}
      >
        <div className="coord-fields">
          <label>
            Service name
            <input
              required
              maxLength={120}
              disabled={busy}
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
            />
          </label>
          <label>
            Service guidance
            <textarea
              maxLength={1000}
              disabled={busy}
              value={config.description}
              onChange={(e) =>
                setConfig({ ...config, description: e.target.value })
              }
            />
          </label>
        </div>
        <details>
          <summary>Reusable brief defaults</summary>
          <p className="coord-small">
            These are starting instructions or an offer. Both sides still review
            the request before agreement. Client identities, addresses,
            confirmed appointments and payment receipts are entered per job.
          </p>
          <div className="coord-fields">
            {INTAKE_DEFAULT_FIELDS.map((key) => (
              <label key={key}>
                {labels[key]}
                <textarea
                  rows={2}
                  maxLength={6000}
                  disabled={busy}
                  value={config.defaults[key] || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      defaults: { ...config.defaults, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <h3>Service questions</h3>
        <p className="coord-small">
          Choose a work-order field for each question. Required answers block
          agreement when missing. Core scope, deliverables, address, access and
          project name always remain required.
        </p>
        {config.questions.map((q, i) => (
          <fieldset className="coord-template-question" key={i} disabled={busy}>
            <legend>Question {i + 1}</legend>
            <div className="coord-fields">
              <label>
                Work-order field
                <select
                  value={q.field}
                  onChange={(e) =>
                    question(i, {
                      field: e.target.value,
                      label: labels[e.target.value],
                      required:
                        REQUIRED_FIELDS.includes(e.target.value) || q.required,
                      options: [],
                      when: undefined,
                    })
                  }
                >
                  {fields
                    .filter(
                      (f) =>
                        f.key === q.field ||
                        !config.questions.some(
                          (other) => other.field === f.key,
                        ),
                    )
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Question wording
                <input
                  required
                  maxLength={120}
                  value={q.label}
                  onChange={(e) => question(i, { label: e.target.value })}
                />
              </label>
              <label>
                Helpful instructions
                <textarea
                  maxLength={500}
                  value={q.help}
                  onChange={(e) => question(i, { help: e.target.value })}
                />
              </label>
              <label className="coord-check">
                <input
                  type="checkbox"
                  checked={q.required}
                  disabled={REQUIRED_FIELDS.includes(q.field)}
                  onChange={(e) => question(i, { required: e.target.checked })}
                />
                Required before agreement
              </label>
              {["text", "textarea"].includes(
                PROJECT_FIELDS.find((f) => f.key === q.field)?.type,
              ) && (
                <label>
                  Answer choices (one per line, or leave empty for free text)
                  <textarea
                    maxLength={1600}
                    value={(q.options || []).join("\n")}
                    onChange={(e) =>
                      question(i, { options: e.target.value.split("\n") })
                    }
                    onBlur={() =>
                      question(i, {
                        options: (q.options || [])
                          .map((option) => option.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              )}
            </div>
            {!REQUIRED_FIELDS.includes(q.field) && (
              <div className="coord-fields">
                <label>
                  Show this question
                  <select
                    value={q.when?.field || ""}
                    onChange={(e) =>
                      question(i, {
                        when: e.target.value
                          ? { field: e.target.value, op: "not_empty" }
                          : undefined,
                      })
                    }
                  >
                    <option value="">Always</option>
                    {fields
                      .filter((f) => f.key !== q.field)
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          When {f.label.toLowerCase()}…
                        </option>
                      ))}
                  </select>
                </label>
                {q.when && (
                  <>
                    <label>
                      Condition
                      <select
                        value={q.when.op}
                        onChange={(e) =>
                          question(i, {
                            when: {
                              ...q.when,
                              op: e.target.value,
                              ...(e.target.value === "not_empty"
                                ? { value: undefined }
                                : { value: q.when.value || "" }),
                            },
                          })
                        }
                      >
                        <option value="not_empty">Has an answer</option>
                        <option value="equals">Equals</option>
                        {q.when.field === "propertySizeSqFt" && (
                          <option value="greater_than">Is greater than</option>
                        )}
                      </select>
                    </label>
                    {q.when.op !== "not_empty" && (
                      <label>
                        Comparison value
                        <input
                          required
                          maxLength={1000}
                          value={q.when.value || ""}
                          onChange={(e) =>
                            question(i, {
                              when: { ...q.when, value: e.target.value },
                            })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                setConfig({
                  ...config,
                  questions: config.questions.filter((_, index) => index !== i),
                })
              }
            >
              Remove question {i + 1}
            </button>
          </fieldset>
        ))}
        <div className="coord-template-actions">
          <button
            type="button"
            disabled={busy || config.questions.length >= 12}
            onClick={() => {
              const field = fields.find(
                (f) => !config.questions.some((q) => q.field === f.key),
              );
              if (field)
                setConfig({
                  ...config,
                  questions: [
                    ...config.questions,
                    {
                      field: field.key,
                      label: field.label,
                      help: "",
                      required: REQUIRED_FIELDS.includes(field.key),
                    },
                  ],
                });
            }}
          >
            Add service question
          </button>
          <button disabled={busy || stale || recovering}>
            {selected
              ? `Save version ${expectedVersion + 1}`
              : "Save service template"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {notice && !dirty && <p role="status">{notice}</p>}
        {dirty && (
          <p role="status">
            Unsaved template wording stays in this page until its next version
            is saved and verified.
          </p>
        )}
        <p className="coord-small">
          Template edits stay in this page until you save. Saving waits for
          verified Google readback.
        </p>
      </form>
    </details>
  );
}
