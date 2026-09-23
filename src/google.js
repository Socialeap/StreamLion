import {
  TABS,
  columnName,
  readRecordHistory,
  rowFor,
  assertUnchanged,
  validateRevision,
} from "./workbook.js";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
let token = "",
  expiresAt = 0,
  session = 0;
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
  token = "";
  expiresAt = 0;
  session++;
}
export function hasGoogleSession() {
  return !!token && Date.now() < expiresAt;
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
  const response = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets" + path,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (generation !== session)
    throw new Error("Google account changed during this request.");
  if (response.status === 401) {
    disconnectGoogle();
    throw new Error("Google session expired. Reconnect.");
  }
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Google denied workbook access. Select the workbook through the Google picker or check permissions."
        : `Google request failed (${response.status}). Refresh before retrying a save.`,
    );
  return response.json();
}
export async function pickWorkbook({ apiKey, appId }) {
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
  return new Promise((resolve, reject) => {
    const view = new window.google.picker.DocsView(
      window.google.picker.ViewId.SPREADSHEETS,
    ).setMode(window.google.picker.DocsViewMode.LIST);
    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
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
export async function readWorkbook(bookId) {
  return (await readWorkbookSnapshot(bookId)).heads;
}
async function readWorkbookSnapshot(bookId) {
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
    history = {};
  Object.entries(TABS).forEach(([name, h], i) => {
    const parsed = readRecordHistory(result.valueRanges[i]?.values || [], h);
    heads[name] = parsed.heads;
    history[name] = parsed.revisions;
  });
  return { heads, history };
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
  const h = TABS[tab];
  if (!h) throw new Error("Unknown workbook tab.");
  validateRevision(revision, h);
  const snapshot = await readWorkbookSnapshot(bookId);
  const before = snapshot.heads;
  const prior = before[tab].find((r) => r.recordId === revision.recordId);
  if (hasSavedRevision(snapshot.history[tab], revision, h)) {
    return before;
  }
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
  const after = await readWorkbookSnapshot(bookId);
  if (!hasSavedRevision(after.history[tab], revision, h))
    throw new Error("Write could not be verified. Refresh before retrying.");
  return after.heads;
}
