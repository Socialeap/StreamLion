import { openLocalDatabase } from "./storage.js";
import { assertWorkspace, emptyWorkspace } from "./model.js";
import { TABS, validateRevision } from "./workbook.js";
import { PROJECT_FIELDS } from "./project-schema.js";
import { validateWorkflow } from "./workflow.js";

export const BACKUP_LIMIT = 100 * 1024 * 1024;
const draftPrefix = "streamlion-draft-v1:";
const id = (value) => typeof value === "string" && /^[\w-]{1,100}$/.test(value);
const prefs = (key) =>
  key === "streamlion-selected-workbook-v1" ||
  /^streamlion-last-project:[\w-]{1,100}$/.test(key);
const conflict = () =>
  new Error(
    "This backup conflicts with records already on this device. Nothing was replaced. Restore it in a fresh browser profile or on another device.",
  );
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
function parseBackupJSON(text) {
  return JSON.parse(text, (key, item) => {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid backup field.");
    return item;
  });
}
function validateDraft(entry) {
  const value = parseBackupJSON(entry.value);
  if (!object(value)) throw new Error("Invalid backup draft.");
  const type = entry.key.split(":")[2];
  if (type === "project") {
    const keys = new Set(PROJECT_FIELDS.map((field) => field.key));
    if (
      !object(value.fields) ||
      Object.entries(value.fields).some(
        ([key, field]) => !keys.has(key) || typeof field !== "string",
      ) ||
      (value.base != null && typeof value.base !== "string")
    )
      throw new Error("Invalid backup project draft.");
  } else if (type === "note") {
    if (typeof value.area !== "string" || typeof value.text !== "string")
      throw new Error("Invalid backup note draft.");
  } else if (type === "measurements") {
    if (
      typeof value.room !== "string" ||
      !Array.isArray(value.entries) ||
      !Array.isArray(value.issues) ||
      typeof value.checked !== "boolean" ||
      (value.input != null && typeof value.input !== "string") ||
      value.entries.some(
        (entry) =>
          !object(entry) ||
          ["id", "label", "display", "raw"].some(
            (key) => typeof entry[key] !== "string",
          ),
      ) ||
      value.issues.some(
        (issue) =>
          !object(issue) ||
          typeof issue.raw !== "string" ||
          typeof issue.message !== "string",
      ) ||
      (value.clarifyingIssue != null &&
        (!Number.isInteger(value.clarifyingIssue) ||
          value.clarifyingIssue < 0 ||
          value.clarifyingIssue >= value.issues.length))
    )
      throw new Error("Invalid backup measurement draft.");
  } else if (type === "checklist") {
    if (!object(value.plan) || typeof value.base !== "string")
      throw new Error("Invalid backup checklist draft.");
    try {
      // Check the shape without requiring an unfinished plan to be saveable.
      validateWorkflow(value.plan, { draft: true });
      if (value.base) validateWorkflow(parseBackupJSON(value.base));
    } catch {
      throw new Error("Invalid backup checklist draft.");
    }
  } else if (type === "pending-write") {
    if (!TABS[value.tab] || typeof value.signature !== "string")
      throw new Error("Invalid backup pending save.");
    validateRevision(value.revision, TABS[value.tab]);
    if (value.expected != null)
      validateRevision(value.expected, TABS[value.tab]);
  }
}
function equal(a, b) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function unique(values, key) {
  if (!Array.isArray(values) || values.length > 20000)
    throw new Error("Invalid backup records.");
  const seen = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object" || seen.has(value[key]))
      throw new Error("Duplicate or invalid backup record.");
    seen.add(value[key]);
  }
}
function workspace(value) {
  assertWorkspace(value);
  for (const records of [value.jobs, value.notes]) {
    unique(records, "id");
    if (records.some((record) => !id(record.id)))
      throw new Error("Invalid device record identity.");
  }
  if (
    value.jobs.some((job) => typeof job.title !== "string" || !job.title.trim())
  )
    throw new Error("Invalid device project.");
  if (
    value.notes.some(
      (note) =>
        !id(note.jobId) ||
        typeof note.area !== "string" ||
        (note.text != null && typeof note.text !== "string"),
    )
  )
    throw new Error("Invalid device field record.");
  return value;
}
function storedWorkspace({ key, value }) {
  if (key === "current") return workspace(value);
  if (
    !/^site-copy:[\w-]{1,100}$/.test(key) ||
    value?.version !== 1 ||
    key !== `site-copy:${value.bookId}` ||
    !Number.isFinite(Date.parse(value.verifiedAt))
  )
    throw new Error("Invalid workbook site copy.");
  for (const [tab, headers] of Object.entries(TABS)) {
    unique(value.data?.[tab], "recordId");
    value.data[tab].forEach((record) => validateRevision(record, headers));
  }
}
function deviceStrings() {
  const values = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(draftPrefix) || prefs(key))
      values.push({ key, value: localStorage.getItem(key) });
  }
  return values.sort((a, b) => a.key.localeCompare(b.key));
}
export async function digest(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function base64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}
function validatePayload(payload) {
  if (!payload || !Number.isFinite(Date.parse(payload.createdAt)))
    throw new Error("Invalid backup date.");
  for (const name of ["workspaces", "media", "deviceStrings"])
    unique(payload[name], "key");
  payload.workspaces.forEach(storedWorkspace);
  for (const entry of payload.deviceStrings) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string")
      throw new Error("Invalid backup draft.");
    if (entry.key.startsWith(draftPrefix)) {
      if (
        !/^streamlion-draft-v1:(local|[\w-]{1,100}):(?:(?:project|note|measurements|checklist):[\w-]{1,100}|pending-write)$/.test(
          entry.key,
        )
      )
        throw new Error("Unrecognized backup draft.");
      // Keep exact draft text and operation IDs, including incomplete fields.
      validateDraft(entry);
    } else if (!prefs(entry.key) || (entry.value && !id(entry.value)))
      throw new Error("Unrecognized backup setting.");
  }
}
export async function createBackup() {
  const strings = deviceStrings();
  const database = await openLocalDatabase();
  const tx = database.transaction(["workspace", "audio"], "readonly");
  const [keys, values, mediaKeys, blobs] = await Promise.all([
    tx.objectStore("workspace").getAllKeys(),
    tx.objectStore("workspace").getAll(),
    tx.objectStore("audio").getAllKeys(),
    tx.objectStore("audio").getAll(),
  ]);
  await tx.done;
  if (!equal(strings, deviceStrings()))
    throw new Error("A draft changed during backup. Try again.");
  const payload = {
    createdAt: new Date().toISOString(),
    workspaces: keys.map((key, index) => ({ key, value: values[index] })),
    media: [],
    deviceStrings: strings,
  };
  let size = JSON.stringify(payload).length;
  for (let index = 0; index < blobs.length; index++) {
    const blob = blobs[index];
    if (
      !(blob instanceof Blob) ||
      !id(mediaKeys[index]) ||
      blob.size < 1 ||
      blob.size > 5 * 1024 * 1024 ||
      !/^(audio|image)\//.test(blob.type)
    )
      throw new Error(
        "A field file could not be backed up. Download its original before continuing.",
      );
    size += Math.ceil(blob.size / 3) * 4;
    if (size > BACKUP_LIMIT)
      throw new Error(
        "This device backup is over 100 MB. Save older originals to Google before trying again.",
      );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    payload.media.push({
      key: mediaKeys[index],
      type: blob.type,
      size: blob.size,
      sha256: await digest(bytes),
      base64: base64(bytes),
    });
  }
  validatePayload(payload);
  for (const entry of payload.workspaces.filter(
    (entry) => entry.key === "current",
  )) {
    for (const note of entry.value.notes) {
      if (note.audioId && !note.audioUrl && !mediaKeys.includes(note.audioId))
        throw new Error(
          "An original field file is missing. This backup would be incomplete.",
        );
    }
  }
  const text = JSON.stringify(payload);
  const file = new Blob(
    [
      JSON.stringify({
        kind: "streamlion.device-backup",
        version: 1,
        sha256: await digest(new TextEncoder().encode(text)),
        payload,
      }),
    ],
    { type: "application/json" },
  );
  if (file.size > BACKUP_LIMIT)
    throw new Error(
      "This device backup is over 100 MB. Save older originals to Google before trying again.",
    );
  return file;
}
export async function inspectBackup(file) {
  if (!file || file.size > BACKUP_LIMIT)
    throw new Error("Choose a StreamLion backup up to 100 MB.");
  const text = await file.text();
  const value = parseBackupJSON(text);
  if (
    value.kind !== "streamlion.device-backup" ||
    value.version !== 1 ||
    value.sha256 !==
      (await digest(new TextEncoder().encode(JSON.stringify(value.payload))))
  )
    throw new Error(
      "This backup is incomplete or damaged. Nothing was changed.",
    );
  validatePayload(value.payload);
  const media = [];
  for (const entry of value.payload.media) {
    if (
      !id(entry.key) ||
      !Number.isInteger(entry.size) ||
      entry.size < 1 ||
      entry.size > 5 * 1024 * 1024 ||
      typeof entry.base64 !== "string" ||
      entry.base64.length > 7 * 1024 * 1024 ||
      !/^(audio|image)\/[\w.+-]+(?:;[\w=.+-]+)*$/.test(entry.type)
    )
      throw new Error("Invalid backup field file.");
    const bytes = Uint8Array.from(atob(entry.base64), (letter) =>
      letter.charCodeAt(0),
    );
    if (bytes.length !== entry.size || (await digest(bytes)) !== entry.sha256)
      throw new Error("A backup field file is damaged. Nothing was changed.");
    media.push({
      key: entry.key,
      blob: new Blob([bytes], { type: entry.type }),
    });
  }
  const saved =
    value.payload.workspaces.find((entry) => entry.key === "current")?.value ||
    emptyWorkspace();
  if (
    saved.notes.some(
      (note) =>
        note.audioId &&
        !note.audioUrl &&
        !media.some((entry) => entry.key === note.audioId),
    )
  )
    throw new Error("This backup is missing an original field file.");
  return {
    payload: value.payload,
    media,
    summary: {
      projects: saved.jobs.length,
      notes: saved.notes.length,
      files: media.length,
      drafts: value.payload.deviceStrings.filter((entry) =>
        entry.key.startsWith(draftPrefix),
      ).length,
    },
  };
}
function mergeRecords(existing, incoming) {
  const records = new Map(existing.map((record) => [record.id, record]));
  for (const record of incoming) {
    if (records.has(record.id) && !equal(records.get(record.id), record))
      throw conflict();
    records.set(record.id, record);
  }
  return [...records.values()];
}
export async function restoreBackup(file) {
  // Re-validate the original file at restore time, never trust UI summary state.
  const { payload, media } = await inspectBackup(file);
  const database = await openLocalDatabase();
  for (const entry of media) {
    const existing = await database.get("audio", entry.key);
    if (
      existing &&
      (existing.type !== entry.blob.type ||
        (await digest(await existing.arrayBuffer())) !==
          (await digest(await entry.blob.arrayBuffer())))
    )
      throw conflict();
  }
  const previousStrings = deviceStrings();
  for (const entry of payload.deviceStrings.filter((entry) =>
    entry.key.startsWith(draftPrefix),
  )) {
    const existing = localStorage.getItem(entry.key);
    if (existing !== null && existing !== entry.value) throw conflict();
  }
  const tx = database.transaction(["workspace", "audio"], "readwrite");
  const done = tx.done.catch((error) => ({ error }));
  const writtenStrings = [];
  try {
    const store = tx.objectStore("workspace");
    for (const entry of payload.workspaces) {
      const existing = await store.get(entry.key);
      let next = entry.value;
      if (entry.key === "current") {
        const current = workspace(existing || emptyWorkspace());
        next = {
          ...current,
          jobs: mergeRecords(current.jobs, next.jobs),
          notes: mergeRecords(current.notes, next.notes),
          revision: (current.revision || 0) + 1,
        };
      } else if (existing && !equal(existing, next)) throw conflict();
      await store.put(next, entry.key);
    }
    for (const entry of media) {
      // Media IDs are immutable. Never replace an existing original.
      if (!(await tx.objectStore("audio").get(entry.key)))
        await tx.objectStore("audio").put(entry.blob, entry.key);
    }
    if (!equal(previousStrings, deviceStrings()))
      throw new Error("A draft changed during restore. Try again.");
    for (const entry of payload.deviceStrings) {
      if (localStorage.getItem(entry.key) === null) {
        localStorage.setItem(entry.key, entry.value);
        writtenStrings.push(entry);
      }
    }
    const result = await done;
    if (result?.error) throw result.error;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await done;
    // Storage spans two browser APIs; undo only strings this restore added.
    for (const entry of writtenStrings) {
      if (localStorage.getItem(entry.key) === entry.value)
        localStorage.removeItem(entry.key);
    }
    throw error;
  }
  return payload;
}
