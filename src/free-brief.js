import { suggestTasks, appendReviewedTasks, READINGS } from "./brief-tasks.js";

export function organizeFreeBrief(text) {
  if (!text.trim())
    throw new Error("Paste your client's requested work first.");
  return {
    text,
    sourceName: "Your pasted brief",
    reviewed: false,
    suggestions: suggestTasks({
      project: {},
      text,
      sourceName: "Your pasted brief",
    }),
  };
}

export function checklistText(draft) {
  const tasks = appendReviewedTasks([], draft);
  return [
    "StreamLion · Reviewed brief checklist",
    "Prepared from your wording. Confirm unresolved requests before doing the work.",
    "",
    ...tasks.flatMap((task, index) => [
      `${index + 1}. [ ] ${task.label}`,
      `   Type: ${task.kind === "review" ? "CLARIFY / OTHER — confirm before work" : task.kind}${task.area ? ` · Space: ${task.area}` : ""}${task.reading ? ` · Reading: ${task.reading}` : ""}`,
      `   Source: ${task.source.quote}`,
      "",
    ]),
    "Prepared with StreamLion · https://streamlion.transcendencemedia.com/api/welcome#free-brief",
    "",
  ].join("\n");
}

export function initializeFreeBrief(document, win = document.defaultView) {
  const root = document.querySelector("#free-brief");
  if (!root) return;
  const input = root.querySelector("#free-brief-input");
  const results = root.querySelector("#free-brief-results");
  const list = root.querySelector("#free-brief-tasks");
  const reviewed = root.querySelector("#free-brief-reviewed");
  const status = root.querySelector("#free-brief-status");
  const copy = root.querySelector("#free-brief-copy");
  const download = root.querySelector("#free-brief-download");
  let draft;
  let revision = 0;
  function invalidate() {
    revision++;
    reviewed.checked = false;
    copy.disabled = download.disabled = true;
    status.textContent = "Changes need a fresh review before you export.";
  }
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }
  function render() {
    list.replaceChildren();
    for (const item of draft.suggestions) {
      const card = element("article");
      card.className = "free-task";
      const includeLabel = element("label", "Include this task ");
      const include = element("input");
      include.type = "checkbox";
      include.checked = item.selected;
      include.addEventListener("change", () => {
        item.selected = include.checked;
        invalidate();
      });
      includeLabel.prepend(include);
      const source = element("blockquote", item.source.quote);
      const title = element(
        "h4",
        item.label || "New task — add the requested wording",
      );
      const badge = element(
        "p",
        item.kind === "review"
          ? "Clarify / other — confirm this request before work."
          : "Check this suggestion against the source below.",
      );
      badge.className = "small";
      card.append(includeLabel, title, badge, source);
      const editor = element("details");
      editor.open = !item.label;
      editor.append(element("summary", "Edit task details"));
      card.append(editor);
      function field(labelText, node, change) {
        const label = element("label", labelText);
        label.append(node);
        node.addEventListener("input", () => {
          change(node.value);
          title.textContent =
            item.label || "New task — add the requested wording";
          invalidate();
        });
        editor.append(label);
      }
      const wording = element("input");
      wording.value = item.label;
      wording.maxLength = 500;
      field("Task wording", wording, (value) => {
        item.label = value;
      });
      const type = element("select");
      for (const [value, text] of [
        ["capture", "Capture"],
        ["measurement", "Measurement"],
        ["delivery", "Delivery"],
        ["review", "Clarify / other"],
      ]) {
        const option = element("option", text);
        option.value = value;
        type.append(option);
      }
      type.value = item.kind;
      const area = element("input");
      area.value = item.area;
      area.maxLength = 200;
      const reading = element("select");
      const blank = element("option", "Choose a dimension");
      blank.value = "";
      reading.append(blank);
      for (const value of READINGS) {
        const option = element("option", value);
        option.value = value;
        reading.append(option);
      }
      reading.value = item.reading || "";
      function syncType() {
        area.required = item.kind === "measurement";
        reading.disabled = item.kind !== "measurement";
        badge.textContent =
          item.kind === "review"
            ? "Clarify / other — confirm this request before work."
            : `${item.kind}${item.area ? ` · ${item.area}` : ""}${item.reading ? ` · ${item.reading}` : ""}`;
      }
      field("Task type", type, (value) => {
        item.kind = value;
        delete item.reading;
        reading.value = "";
        syncType();
      });
      field("Space / area (required for measurements)", area, (value) => {
        item.area = value;
        syncType();
      });
      field("Measurement dimension", reading, (value) => {
        if (value) item.reading = value;
        else delete item.reading;
        syncType();
      });
      syncType();
      const split = element("button", "Add another task from this passage");
      split.type = "button";
      split.className = "button secondary";
      split.addEventListener("click", () => {
        if (draft.suggestions.length >= 40) {
          status.textContent =
            "A checklist supports up to 40 suggestions. Organize a smaller brief.";
          return;
        }
        const added = {
          ...item,
          id: win.crypto.randomUUID(),
          label: "",
          kind: "review",
          area: "",
          selected: true,
        };
        delete added.reading;
        draft.suggestions.splice(draft.suggestions.indexOf(item) + 1, 0, added);
        invalidate();
        render();
        list
          .querySelectorAll("article")
          [draft.suggestions.indexOf(added)].querySelector(
            'input:not([type="checkbox"])',
          )
          .focus();
      });
      editor.append(split);
      list.append(card);
    }
    results.hidden = false;
  }
  input.addEventListener("input", () => {
    draft = undefined;
    list.replaceChildren();
    results.hidden = true;
    invalidate();
    status.textContent = "Brief changed. Organize it again before reviewing.";
  });
  root.querySelector("#free-brief-organize").addEventListener("click", () => {
    draft = undefined;
    list.replaceChildren();
    results.hidden = true;
    invalidate();
    try {
      draft = organizeFreeBrief(input.value);
      render();
      const uncertain = draft.suggestions.filter(
        (item) => item.kind === "review",
      ).length;
      status.textContent = `${draft.suggestions.length} suggestions. ${uncertain} ${uncertain === 1 ? "needs" : "need"} clarification or manual organization. Check every task, room and exclusion.`;
      results.querySelector("h3").focus();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  reviewed.addEventListener("change", () => {
    copy.disabled = download.disabled = true;
    if (!reviewed.checked || !draft) return;
    try {
      checklistText({ ...draft, reviewed: true });
      copy.disabled = download.disabled = false;
      status.textContent =
        "Ready to export. Items marked Clarify / other still need confirmation before work.";
    } catch (error) {
      reviewed.checked = false;
      status.textContent = error.message;
    }
  });
  copy.addEventListener("click", async () => {
    const copiedRevision = revision;
    try {
      const text = checklistText({ ...draft, reviewed: reviewed.checked });
      await win.navigator.clipboard.writeText(text);
      if (revision === copiedRevision)
        status.textContent =
          "Checklist copied. Keep the source wording with your tasks.";
    } catch {
      if (revision === copiedRevision)
        status.textContent =
          "Copy is unavailable. Use Download checklist instead.";
    }
  });
  download.addEventListener("click", () => {
    try {
      const blob = new win.Blob(
        [checklistText({ ...draft, reviewed: reviewed.checked })],
        { type: "text/plain;charset=utf-8" },
      );
      const url = win.URL.createObjectURL(blob);
      const anchor = element("a");
      anchor.href = url;
      anchor.download = "streamlion-brief-checklist.txt";
      root.append(anchor);
      anchor.click();
      anchor.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
      status.textContent = "Checklist download started.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  root.querySelector("#free-brief-clear").addEventListener("click", () => {
    draft = undefined;
    input.value = "";
    list.replaceChildren();
    results.hidden = true;
    invalidate();
    status.textContent = "Brief and suggestions cleared from this tool.";
    input.focus();
  });
}
