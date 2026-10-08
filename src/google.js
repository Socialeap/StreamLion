import {
  TABS,
  columnName,
  readRecordHistory,
  rowFor,
  assertUnchanged,
  validateRevision,
} from "./workbook.js";
import { folderAdapter } from "./drive-folders.js";
import { fetchRead } from "./network.js";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const COORDINATED_SAVE_GUIDANCE = new Map([
  [
    "This coordinated job is not open for field work.",
    "This client job is closed or not yet accepted. Review it in Client requests before retrying this field record. Your draft is kept.",
  ],
  [
    "Edit this coordinated project's brief and payment status in Client requests.",
    "Update this client's brief and payment status in Client requests. Your project draft is kept on this device.",
  ],
]);
let token = "",
  expiresAt = 0,
  session = 0;
let persistentSession = null;
let restorePromise = null;
let selectedFolder = "";
let folders = newFolderAdapter();
function assertGoogleGeneration(generation) {
  if (generation !== session)
    throw new Error(
      "Google account changed. Reopen the project before retrying.",
    );
}
function newFolderAdapter() {
  const generation = session;
  const check = () => {
    if (generation !== session)
      throw new Error(
        "Google account changed. Reopen the project before retrying.",
      );
  };
  return folderAdapter(
    async (...args) => {
      check();
      const result = await driveRequest(...args);
      check();
      return result;
    },
    async () => {
      check();
      const id = await reserveFieldFileId();
      check();
      return id;
    },
  );
}
export async function restoreGoogleSession() {
  if (restorePromise) return restorePromise;
  const generation = session;
  restorePromise = (async () => {
    let response;
    try {
      response = await fetchRead("/api/google/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      throw new Error(
        "Could not restore Google. Check your connection and retry in Connections.",
      );
    }
    if (response.status === 401) {
      if (generation === session) disconnectGoogle();
      return { enabled: true, connected: false };
    }
    if (!response.ok)
      throw new Error(
        "Could not restore Google. Check your connection and retry in Connections.",
      );
    const data = await response.json().catch(() => {
      throw new Error(
        "Google connection could not be checked. Retry in Connections.",
      );
    });
    if (
      !data ||
      typeof data.enabled !== "boolean" ||
      typeof data.connected !== "boolean" ||
      (data.connected &&
        (data.enabled !== true ||
          typeof data.subject !== "string" ||
          !data.subject ||
          typeof data.bookId !== "string" ||
          !/^[\w-]{0,100}$/.test(data.bookId) ||
          (data.folderId != null &&
            (typeof data.folderId !== "string" ||
              !/^[\w-]{0,100}$/.test(data.folderId)))))
    )
      throw new Error(
        "Google returned an invalid connection. Retry in Connections.",
      );
    if (generation !== session) throw new Error("Google connection changed.");
    if (data.connected && persistentSession?.subject !== data.subject) {
      session++;
      folders = newFolderAdapter();
    }
    persistentSession = data.connected ? data : null;
    selectedFolder = data.connected ? data.folderId || "" : "";
    return data;
  })();
  try {
    return await restorePromise;
  } finally {
    restorePromise = null;
  }
}
export function googleFolderId() {
  return selectedFolder;
}
export async function rememberGoogleFolder(id) {
  const generation = session;
  await folders.metadata(id);
  assertGoogleGeneration(generation);
  if (persistentSession) {
    const response = await sessionRequest("folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: id }),
    });
    if (!response.ok)
      throw new Error(
        "Could not remember this folder. Try again before adding files.",
      );
    persistentSession = { ...persistentSession, folderId: id };
  }
  assertGoogleGeneration(generation);
  selectedFolder = id;
  return id;
}
export async function ensureGoogleFolder() {
  const generation = session;
  if (selectedFolder) {
    await folders.metadata(selectedFolder);
    assertGoogleGeneration(generation);
    return selectedFolder;
  }
  const folder = await folders.ensure("StreamLion", "workspace");
  assertGoogleGeneration(generation);
  return rememberGoogleFolder(folder.id);
}
export async function projectFolder(bookId, projectId, title = "Project") {
  if (
    !/^[\w-]{1,100}$/.test(bookId || "") ||
    !/^[\w-]{1,100}$/.test(projectId || "")
  )
    throw new Error("Save this project before opening its folder.");
  const generation = session;
  const adapter = folders;
  const root = await ensureGoogleFolder();
  assertGoogleGeneration(generation);
  const files = await adapter.ensure("Project files", "project-files", root);
  return (
    await adapter.ensure(
      `${title} — ${projectId}`,
      "project",
      files.id,
      bookId,
      projectId,
    )
  ).id;
}
export async function moveWorkbookToFolder(bookId) {
  if (!/^[\w-]{1,100}$/.test(bookId || ""))
    throw new Error("Choose a workbook first.");
  const generation = session;
  const folderId = await ensureGoogleFolder();
  assertGoogleGeneration(generation);
  const check = await driveRequest(
    `drive/v3/files/${bookId}?fields=id,mimeType,parents`,
  );
  if (!check.ok)
    throw new Error("Could not check workbook location. Try again.");
  const file = await check.json();
  assertGoogleGeneration(generation);
  if (file.mimeType !== "application/vnd.google-apps.spreadsheet")
    throw new Error("Choose a Google workbook.");
  if (file.parents?.includes(folderId)) return;
  const params = new URLSearchParams({
    addParents: folderId,
    fields: "id,parents",
    ...(file.parents?.length && { removeParents: file.parents.join(",") }),
  });
  const response = await driveRequest(`drive/v3/files/${bookId}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok || !(await response.json()).parents?.includes(folderId))
    throw new Error(
      "Workbook move has not been confirmed. Your workbook still exists; retry moving it.",
    );
}
export function googleAccount() {
  return persistentSession?.account || "";
}
async function sessionRequest(path, options = {}) {
  const generation = session;
  const response = await fetchRead("/api/google/" + path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...options.headers,
      "X-StreamLion-Account": persistentSession?.subject || "",
    },
  });
  if (generation !== session)
    throw new Error("Google connection changed during this request.");
  if (response.status === 401) {
    disconnectGoogle();
    throw new Error(
      "Google connection expired. Reconnect in Connections; your draft is preserved.",
    );
  }
  return response;
}
export async function rememberGoogleWorkbook(bookId) {
  if (!persistentSession) return;
  const response = await sessionRequest("workbook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId }),
  });
  if (!response.ok)
    throw new Error(
      "Could not remember this workbook. Retry before switching projects.",
    );
  persistentSession = { ...persistentSession, bookId };
}
export async function forgetGoogleConnection() {
  if (persistentSession) {
    const response = await sessionRequest("disconnect", { method: "POST" });
    if (!response.ok)
      throw new Error(
        "Could not disconnect Google. Check your connection and retry.",
      );
  }
  disconnectGoogle();
}
export function startPersistentGoogle() {
  window.location.assign("/api/google/start");
}
const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src))
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
          scripts.delete(src);
          s.remove();
          reject(new Error("Google could not load. Check your connection."));
        };
        document.head.append(s);
      }),
    );
  return scripts.get(src);
}
export function disconnectGoogle() {
  persistentSession = null;
  selectedFolder = "";
  token = "";
  expiresAt = 0;
  session++;
  folders = newFolderAdapter();
}
export function hasGoogleSession() {
  return !!persistentSession || (!!token && Date.now() < expiresAt);
}
export async function connectGoogle(clientId) {
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new Error(
      "Google sign-in is unavailable. Please contact StreamLion support.",
    );
  await loadScript("https://accounts.google.com/gsi/client");
  disconnectGoogle();
  const generation = session;
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (generation !== session)
          return reject(new Error("Connection cancelled."));
        if (r.error)
          return reject(new Error("Google authorization was not completed."));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE))
          return reject(new Error("Google file access was not granted."));
        token = r.access_token;
        expiresAt = Date.now() + (Number(r.expires_in) - 60) * 1000;
        resolve();
      },
      error_callback: () =>
        reject(
          new Error("Google sign-in was closed or blocked. Try Connect again."),
        ),
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}
async function request(path, options = {}) {
  if (!hasGoogleSession())
    throw new Error(
      "Google session expired. Reconnect in Connections; your draft is preserved.",
    );
  const generation = session;
  const response = persistentSession
    ? await sessionRequest("sheets?path=" + encodeURIComponent(path), {
        ...options,
        headers: { "Content-Type": "application/json" },
      })
    : await fetchRead("https://sheets.googleapis.com/v4/spreadsheets" + path, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
  if (generation !== session)
    throw new Error("Google account changed during this request.");
  if (response.status === 401) {
    disconnectGoogle();
    throw new Error("Google session expired. Reconnect.");
  }
  if (!response.ok) {
    if (
      persistentSession &&
      response.status === 409 &&
      options.method === "POST" &&
      path.includes(":append?")
    ) {
      const failure = await response.json().catch(() => null);
      if (generation !== session)
        throw new Error("Google account changed during this request.");
      const guidance = COORDINATED_SAVE_GUIDANCE.get(failure?.error);
      if (guidance) throw new Error(guidance);
    }
    throw new Error(
      response.status === 403
        ? "Google denied workbook access. Select the workbook through the Google picker or check permissions."
        : response.status === 429
          ? "Google is busy. Your draft is kept. Wait a moment, then retry."
          : `Google request failed (${response.status}). Refresh before retrying a save.`,
    );
  }
  return response.json();
}
export async function pickWorkbook({ apiKey, appId }, folder = false) {
  if (!hasGoogleSession()) throw new Error("Connect Google first.");
  if (!apiKey || !/^\d+$/.test(appId))
    throw new Error(
      "Choosing an existing workbook is unavailable. Please contact StreamLion support.",
    );
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((resolve, reject) =>
    window.gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Google Picker unavailable.")),
    }),
  );
  const generation = session;
  let pickerToken = token;
  if (persistentSession) {
    const response = await sessionRequest("picker-token", { method: "POST" });
    if (!response.ok)
      throw new Error("Google Picker is temporarily unavailable. Retry.");
    pickerToken = (await response.json()).accessToken;
  }
  return new Promise((resolve, reject) => {
    const view = new window.google.picker.DocsView(
      folder
        ? window.google.picker.ViewId.FOLDERS
        : window.google.picker.ViewId.SPREADSHEETS,
    ).setMode(window.google.picker.DocsViewMode.LIST);
    if (folder) view.setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(pickerToken)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (generation !== session)
          return reject(new Error("Google account changed."));
        if (data.action === "picked") resolve(data.docs[0].id);
        if (data.action === "cancel") resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
export async function createWorkbook() {
  const generation = session;
  await ensureGoogleFolder();
  assertGoogleGeneration(generation);
  const sheets = Object.entries(TABS).map(([title, headers], sheetId) => ({
    properties: {
      sheetId,
      title,
      gridProperties: {
        rowCount: 1000,
        columnCount: headers.length,
        frozenRowCount: 1,
      },
    },
    data: [
      {
        startRow: 0,
        startColumn: 0,
        rowData: [
          {
            values: headers.map((stringValue) => ({
              userEnteredValue: { stringValue },
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.88, green: 0.94, blue: 0.9 },
              },
            })),
          },
        ],
      },
    ],
  }));
  return request("", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "StreamLion Projects" },
      sheets,
    }),
  });
}

async function driveRequest(path, options = {}) {
  if (!hasGoogleSession())
    throw new Error(
      "Reconnect Google before sending field files. Your originals stay on this device.",
    );
  const generation = session;
  const response = persistentSession
    ? await sessionRequest("drive?path=" + encodeURIComponent(path), options)
    : await fetchRead(`https://www.googleapis.com/${path}`, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
  if (generation !== session)
    throw new Error(
      "Google account changed during this request. Reconnect before retrying.",
    );
  if (response.status === 401) {
    disconnectGoogle();
    throw new Error("Google session expired. Reconnect.");
  }
  return response;
}

export async function reserveFieldFileId() {
  const response = await driveRequest(
    "drive/v3/files/generateIds?count=1&space=drive&type=files",
  );
  if (!response.ok)
    throw new Error(
      `Google could not prepare this file (${response.status}). Retry later.`,
    );
  const id = (await response.json()).ids?.[0];
  if (!/^[\w-]+$/.test(id || ""))
    throw new Error("Google returned an invalid file ID.");
  return id;
}

export async function retainFieldFile({
  fileId,
  noteId,
  bookId,
  projectId,
  projectTitle,
  name,
  blob,
}) {
  if (!blob?.size || blob.size > 5 * 1024 * 1024)
    throw new Error(
      "Choose a field photo or recording up to 5 MB. The original stays on this device.",
    );
  if (![fileId, noteId, bookId].every((id) => /^[\w-]+$/.test(id || "")))
    throw new Error("Invalid field file destination.");
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const probe = async () => {
    const response = await driveRequest(
      `drive/v3/files/${fileId}?fields=id,size,trashed,appProperties`,
    );
    if (response.status === 404) return false;
    if (!response.ok)
      throw new Error(
        `Google could not verify this file (${response.status}). Retry later.`,
      );
    const file = await response.json();
    if (
      file.trashed ||
      String(file.size) !== String(blob.size) ||
      file.appProperties?.streamlionNote !== noteId ||
      file.appProperties?.streamlionBook !== bookId ||
      (projectId &&
        file.appProperties?.streamlionProject &&
        file.appProperties.streamlionProject !== projectId) ||
      file.appProperties?.sha256 !== digest
    )
      throw new Error(
        "This Drive file does not match the saved field record. Keep the original and contact support.",
      );
    return true;
  };
  if (!(await probe())) {
    const folderId = projectId
      ? await projectFolder(bookId, projectId, projectTitle)
      : "";
    const boundary = `streamlion_${crypto.randomUUID().replaceAll("-", "")}`;
    const metadata = {
      id: fileId,
      ...(folderId && { parents: [folderId] }),
      name: name || `StreamLion field record ${noteId}`,
      mimeType: blob.type || "application/octet-stream",
      appProperties: {
        streamlionNote: noteId,
        streamlionBook: bookId,
        ...(projectId && { streamlionProject: projectId }),
        sha256: digest,
      },
    };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const response = await driveRequest(
      "upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (!response.ok && response.status !== 409)
      throw new Error(
        `Google upload awaiting verification (${response.status}). Retry with the same saved file.`,
      );
    if (!(await probe()))
      throw new Error(
        "Google has not confirmed this file yet. Keep the original and retry.",
      );
  }
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export async function readFieldFile(url) {
  const match = /^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/view$/.exec(
    url || "",
  );
  if (!match) throw new Error("Open this file in Drive to review it.");
  const response = await driveRequest(`drive/v3/files/${match[1]}?alt=media`);
  if (!response.ok)
    throw new Error(
      "This field file is unavailable. Check its access in Drive.",
    );
  return response.blob();
}
export async function readWorkbook(bookId) {
  return (await readWorkbookSnapshot(bookId)).heads;
}
async function readWorkbookSnapshot(bookId) {
  const scope = `${session}:${bookId}`;
  if (readingWorkbooks.has(scope)) return readingWorkbooks.get(scope);
  const task = loadWorkbookSnapshot(bookId);
  readingWorkbooks.set(scope, task);
  try {
    return await task;
  } finally {
    if (readingWorkbooks.get(scope) === task) readingWorkbooks.delete(scope);
  }
}
const readingWorkbooks = new Map();
async function loadWorkbookSnapshot(bookId) {
  if (!/^[\w-]+$/.test(bookId)) throw new Error("Invalid workbook ID.");
  // Reject truncated workbooks instead of silently losing projects at a scan limit.
  const meta = await request(
    `/${bookId}?fields=spreadsheetId,spreadsheetUrl,properties(title),sheets(properties)`,
  );
  const rowCounts = {};
  for (const name of Object.keys(TABS)) {
    const p = meta.sheets.find((s) => s.properties.title === name)?.properties;
    if (!p)
      throw new Error(`Missing ${name} tab. Select a StreamLion workbook.`);
    if (p.gridProperties.rowCount > 10000)
      throw new Error(
        "Workbook exceeds the pilot limit of 10,000 rows per tab. Archive with review before continuing.",
      );
    rowCounts[name] = p.gridProperties.rowCount;
  }
  // Include all populated columns so an added header cannot be silently ignored.
  const params = Object.keys(TABS)
    .map(
      (name) => "ranges=" + encodeURIComponent(`${name}!1:${rowCounts[name]}`),
    )
    .join("&");
  const result = await request(
    `/${bookId}/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE`,
  );
  const heads = {},
    history = {},
    populatedRows = {};
  Object.entries(TABS).forEach(([name, h], i) => {
    const parsed = readRecordHistory(result.valueRanges[i]?.values || [], h);
    heads[name] = parsed.heads;
    history[name] = parsed.revisions;
    populatedRows[name] = result.valueRanges[i]?.values?.length || 0;
  });
  return { heads, history, populatedRows };
}
function hasSavedRevision(history, revision, headers) {
  const saved = history.find((r) => r.revisionId === revision.revisionId);
  if (!saved) return false;
  if (
    JSON.stringify(rowFor(saved, headers)) !==
    JSON.stringify(rowFor(revision, headers))
  )
    throw new Error("Revision ID already has different content.");
  return true;
}
export async function appendRevision(bookId, tab, revision, expected) {
  if (!/^[\w-]+$/.test(bookId)) throw new Error("Invalid workbook ID.");
  const generation = session;
  const perform = () => {
    if (generation !== session)
      throw new Error("Google account changed before this save.");
    return appendLocked(bookId, tab, revision, expected);
  };
  // Coordinate independent editor tabs on the same device. Google revision
  // validation remains necessary for other devices and external Sheet edits.
  if (typeof navigator !== "undefined" && navigator.locks?.request)
    return navigator.locks.request(
      `streamlion-workbook-write:${bookId}`,
      perform,
    );
  const previous = writingWorkbooks.get(bookId) || Promise.resolve();
  const task = previous.catch(() => {}).then(perform);
  writingWorkbooks.set(bookId, task);
  try {
    return await task;
  } finally {
    if (writingWorkbooks.get(bookId) === task) writingWorkbooks.delete(bookId);
  }
}
const writingWorkbooks = new Map();
async function appendLocked(bookId, tab, revision, expected) {
  const h = TABS[tab];
  if (!h) throw new Error("Unknown workbook tab.");
  validateRevision(revision, h);
  const snapshot = await readWorkbookSnapshot(bookId);
  const before = snapshot.heads;
  const prior = before[tab].find((r) => r.recordId === revision.recordId);
  if (hasSavedRevision(snapshot.history[tab], revision, h)) {
    return before;
  }
  if (snapshot.populatedRows[tab] >= 10000)
    throw new Error(
      "This workbook is full. Archive its history with review before adding more records; your draft is kept.",
    );
  assertUnchanged(prior, expected);
  if (
    tab === "Observations" &&
    !before.Projects.some((p) => p.recordId === revision.projectId)
  )
    throw new Error("Save this project to Google before its annotation.");
  // RAW prevents source text beginning with '=' from becoming a spreadsheet formula.
  const range = encodeURIComponent(`${tab}!A:${columnName(h.length - 1)}`);
  await request(
    `/${bookId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [rowFor(revision, h)] }) },
  );
  // A timeout has an unknown outcome; caller retains the SAME revision ID for retry.
  const after = await loadWorkbookSnapshot(bookId);
  if (!hasSavedRevision(after.history[tab], revision, h))
    throw new Error("Write could not be verified. Refresh before retrying.");
  return after.heads;
}
