import { googleFetch, seal, unseal } from "./google-auth.js";
import { reserveGoogleRequest } from "./google-limits.js";
import { boundedText } from "./request-body.js";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  rowFor,
  readRecordHistory,
} from "../src/workbook.js";
import { stableJSON, CoordinationError } from "../src/client-workflow.js";
export const EVENT_HEADERS = [
  "eventId",
  "jobId",
  "revision",
  "parentRevision",
  "at",
  "actor",
  "action",
  "payload",
  "signature",
];
export const ARCHIVE_HEADERS = [
  "jobId",
  "closedAt",
  "archiveFileId",
  "version",
];
const validID = (id) => /^[\w-]{1,100}$/.test(id || "");
export class CoordinationGoogle {
  constructor(env, connection) {
    this.env = env;
    this.connection = connection;
    this.verifiedEvents = new Map();
    if (!validID(connection.workbook_id) || !validID(connection.folder_id))
      throw new CoordinationError(
        "Reconnect the selected Google workspace.",
        409,
      );
  }
  async token() {
    const c = this.connection;
    if (c.revoked || c.expires_at <= Date.now())
      throw new CoordinationError(
        "Provider Google connection needs renewal.",
        409,
      );
    const value = await unseal(this.env, c.credentials, c.id);
    if (value.expiresAt > Date.now() + 30000) return value.accessToken;
    if (!value.refreshToken)
      throw new CoordinationError("Provider must reconnect Google.", 409);
    const response = await googleFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.env.VITE_GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        refresh_token: value.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const refreshed = await response.json();
    if (!response.ok || typeof refreshed.access_token !== "string")
      throw new CoordinationError("Provider must reconnect Google.", 409);
    const credentials = await seal(
      this.env,
      {
        ...value,
        accessToken: refreshed.access_token,
        expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      },
      c.id,
    );
    const result = await this.env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_coordination_connections_v1 SET credentials=? WHERE id=? AND credentials=? AND revoked=0",
    )
      .bind(credentials, c.id, c.credentials)
      .run();
    if (result.meta.changes) c.credentials = credentials;
    else {
      const current = await this.env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
      )
        .bind(c.id)
        .first();
      if (!current || current.revoked || current.expires_at <= Date.now())
        throw new CoordinationError("Google connection changed.", 409);
      c.credentials = current.credentials;
      return (await unseal(this.env, current.credentials, c.id)).accessToken;
    }
    return refreshed.access_token;
  }
  async call(url, options = {}) {
    if (
      !["https://sheets.googleapis.com", "https://www.googleapis.com"].includes(
        new URL(url).origin,
      )
    )
      throw new Error("invalid_google_host");
    const capacity = await reserveGoogleRequest(
      this.env.GOOGLE_SESSIONS,
      this.connection.google_subject,
      options.method || "GET",
    );
    if (!capacity.allowed)
      throw new CoordinationError(
        "Google is busy. Your operation is retained for retry.",
        429,
      );
    const response = await googleFetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: "Bearer " + (await this.token()),
      },
    });
    if (!response.ok)
      throw new CoordinationError(
        "Google could not verify this operation. Retry the same operation.",
        503,
      );
    return response;
  }
  async json(url, options = {}) {
    const response = await this.call(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    return JSON.parse(await boundedText(response, 8 * 1024 * 1024));
  }
  sheet(path) {
    return (
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      this.connection.workbook_id +
      path
    );
  }
  async ensure() {
    if (!this.env.GOOGLE_TOKEN_ENCRYPTION_KEY)
      throw new CoordinationError(
        "Coordination signing configuration is unavailable.",
        503,
      );
    const file = await this.json(
      "https://www.googleapis.com/drive/v3/files/" +
        this.connection.workbook_id +
        "?fields=ownedByMe,permissions(type,role)",
    );
    if (
      !file.ownedByMe ||
      !file.permissions?.length ||
      file.permissions.some((p) => p.type !== "user" || p.role !== "owner")
    )
      throw new CoordinationError(
        "Use a private provider-owned workbook for coordination.",
        409,
      );
    const book = await this.json(this.sheet("?fields=sheets.properties"));
    const names = book.sheets.map((s) => s.properties.title);
    if (!names.includes("Projects") || !names.includes("Observations"))
      throw new CoordinationError(
        "Select a compatible StreamLion workbook.",
        409,
      );
    const added = ["CoordinationEvents", "ArchiveIndex"].filter(
      (n) => !names.includes(n),
    );
    if (added.length === 1)
      throw new CoordinationError(
        "Workbook coordination setup is incomplete. Stop for review.",
        409,
      );
    if (added.length === 2) {
      const used = new Set(book.sheets.map((s) => s.properties.sheetId));
      let first = 741920;
      while (used.has(first) || used.has(first + 1)) first += 2;
      await this.json(this.sheet(":batchUpdate"), {
        method: "POST",
        body: JSON.stringify({
          requests: added.flatMap((title, i) => [
            { addSheet: { properties: { title, sheetId: first + i } } },
            {
              updateCells: {
                start: { sheetId: first + i, rowIndex: 0, columnIndex: 0 },
                rows: [
                  {
                    values: (i === 0 ? EVENT_HEADERS : ARCHIVE_HEADERS).map(
                      (stringValue) => ({ userEnteredValue: { stringValue } }),
                    ),
                  },
                ],
                fields: "userEnteredValue",
              },
            },
          ]),
        }),
      });
    }
    await this.snapshot();
  }
  async snapshot() {
    const query = new URLSearchParams();
    for (const name of [
      "Projects",
      "Observations",
      "CoordinationEvents",
      "ArchiveIndex",
    ])
      query.append("ranges", name);
    const data = await this.json(this.sheet("/values:batchGet?" + query));
    const rows = data.valueRanges.map((r) => r.values || []);
    for (const [i, headers] of [
      PROJECT_HEADERS,
      NOTE_HEADERS,
      EVENT_HEADERS,
      ARCHIVE_HEADERS,
    ].entries())
      if (
        stableJSON(rows[i][0]) !== stableJSON(headers) ||
        rows[i].length > 10000
      )
        throw new CoordinationError(
          "Workbook headers or capacity need reviewed recovery.",
          409,
        );
    const projects = readRecordHistory(rows[0], PROJECT_HEADERS);
    const notes = readRecordHistory(rows[1], NOTE_HEADERS);
    const events = new Map();
    for (const r of rows[2].slice(1)) {
      if (!r[0]) continue;
      const event = {
        id: r[0],
        jobId: r[1],
        revision: Number(r[2]),
        parent: Number(r[3]),
        at: Number(r[4]),
        actor: r[5],
        action: r[6],
        job: JSON.parse(r[7]),
      };
      const signed = stableJSON(event) + "." + r[8];
      if (this.verifiedEvents.get(event.id) !== signed) {
        if (!(await this.signature(event, r[8])))
          throw new CoordinationError(
            "Coordination history signature is invalid. Preserve the workbook for review.",
            409,
          );
        this.verifiedEvents.set(event.id, signed);
      }
      if (
        !validID(event.id) ||
        !validID(event.jobId) ||
        event.job.version !== 1 ||
        !["provider", "client", "system"].includes(event.actor) ||
        event.job.id !== event.jobId ||
        event.job.revision !== event.revision ||
        !Number.isSafeInteger(event.revision)
      )
        throw new CoordinationError(
          "Invalid coordination history. Preserve the workbook for review.",
          409,
        );
      if (
        events.has(event.id) &&
        stableJSON(events.get(event.id)) !== stableJSON(event)
      )
        throw new CoordinationError("Conflicting duplicate event.", 409);
      events.set(event.id, event);
    }
    const heads = new Map();
    for (const id of new Set([...events.values()].map((e) => e.jobId))) {
      const chain = [...events.values()]
        .filter((e) => e.jobId === id)
        .sort((a, b) => a.revision - b.revision);
      if (chain.some((e, i) => e.revision !== i || e.parent !== i - 1))
        throw new CoordinationError(
          "Concurrent or incomplete client revisions require review.",
          409,
        );
      heads.set(id, chain.at(-1).job);
    }
    if (
      [...heads.values()].some(
        (job) => job.provider !== this.connection.google_subject,
      )
    )
      throw new CoordinationError(
        "This workbook contains another provider's coordination records. Stop for review.",
        409,
      );
    return { rows, projects, notes, events, heads };
  }
  async append(tab, values) {
    await this.json(
      this.sheet(
        "/values/" +
          encodeURIComponent(tab + "!A:ZZ") +
          ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
      ),
      { method: "POST", body: JSON.stringify({ values: [values] }) },
    );
  }
  async event(event) {
    let snapshot = await this.snapshot();
    const existing = snapshot.events.get(event.id);
    if (existing) {
      if (stableJSON(existing) !== stableJSON(event))
        throw new CoordinationError("Event identity changed.", 409);
      return;
    }
    if ((snapshot.heads.get(event.jobId)?.revision ?? -1) !== event.parent)
      throw new CoordinationError(
        "This job changed before saving. Review its history.",
        409,
      );
    if (snapshot.rows[2].length >= 10000)
      throw new CoordinationError(
        "Archive workbook history before continuing.",
        409,
      );
    await this.append("CoordinationEvents", [
      event.id,
      event.jobId,
      event.revision,
      event.parent,
      event.at,
      event.actor,
      event.action,
      stableJSON(event.job),
      await this.signature(event),
    ]);
    snapshot = await this.snapshot();
    if (stableJSON(snapshot.events.get(event.id)) !== stableJSON(event))
      throw new CoordinationError(
        "Save outcome is unverified. Retry the same operation.",
        503,
      );
  }
  async projection(revision, allowedHead) {
    if (!revision) return;
    const snapshot = await this.snapshot();
    const found = snapshot.projects.revisions.find(
      (r) => r.revisionId === revision.revisionId,
    );
    if (found) {
      if (stableJSON(found) !== stableJSON(revision))
        throw new CoordinationError("Field brief identity changed.", 409);
      const head = snapshot.projects.heads.find(
        (r) => r.recordId === revision.recordId,
      )?.revisionId;
      if (head !== revision.revisionId && head !== allowedHead)
        throw new CoordinationError(
          "Field brief changed during recovery. Stop for reviewed reconciliation.",
          409,
        );
      return;
    }
    if (
      (snapshot.projects.heads.find((r) => r.recordId === revision.recordId)
        ?.revisionId || "") !== revision.parentRevisionId
    )
      throw new CoordinationError(
        "Field brief changed outside coordination. Stop for reviewed recovery.",
        409,
      );
    await this.append("Projects", rowFor(revision, PROJECT_HEADERS));
    const after = await this.snapshot();
    if (
      stableJSON(
        after.projects.revisions.find(
          (r) => r.revisionId === revision.revisionId,
        ),
      ) !== stableJSON(revision)
    )
      throw new CoordinationError(
        "Field brief save is unverified. Retry the same operation.",
        503,
      );
  }
  async signature(event, signature) {
    this.signingKey ||= crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.env.GOOGLE_TOKEN_ENCRYPTION_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const key = await this.signingKey;
    const body = new TextEncoder().encode(
      stableJSON({
        domain: "streamlion.coordination.v1",
        workbook: this.connection.workbook_id,
        provider: this.connection.google_subject,
        mode: this.connection.mode,
        event,
      }),
    );
    if (arguments.length > 1) {
      if (
        typeof signature !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(signature)
      )
        return false;
      const bytes = Uint8Array.from(
        atob(signature.replaceAll("-", "+").replaceAll("_", "/")),
        (c) => c.charCodeAt(0),
      );
      return crypto.subtle.verify("HMAC", key, bytes, body);
    }
    return btoa(
      String.fromCharCode(
        ...new Uint8Array(await crypto.subtle.sign("HMAC", key, body)),
      ),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  }
  async privateFolder() {
    const folder = await this.json(
      "https://www.googleapis.com/drive/v3/files/" +
        this.connection.folder_id +
        "?fields=id,mimeType,ownedByMe,capabilities(canAddChildren),permissions(type,role)",
    );
    if (
      folder.mimeType !== "application/vnd.google-apps.folder" ||
      !folder.ownedByMe ||
      !folder.capabilities?.canAddChildren ||
      !folder.permissions?.length ||
      folder.permissions.some((p) => p.type !== "user" || p.role !== "owner")
    )
      throw new CoordinationError(
        "Use a private provider-owned Drive folder for coordination.",
        409,
      );
  }
  async archivePlan(job) {
    await this.privateFolder();
    const snapshot = await this.snapshot();
    const history = [...snapshot.events.values()].filter(
      (e) => e.jobId === job.id,
    );
    const records = snapshot.projects.revisions.filter(
      (r) => r.recordId === job.id,
    );
    const notes = snapshot.notes.revisions.filter(
      (r) => r.projectId === job.id,
    );
    const attachments = [];
    for (const attachment of job.attachments) {
      if (!validID(attachment.driveId))
        throw new CoordinationError(
          "Attachment archive needs reviewed recovery.",
          409,
        );
      const file = await this.json(
        "https://www.googleapis.com/drive/v3/files/" +
          attachment.driveId +
          "?fields=id,name,size,md5Checksum,parents,trashed,ownedByMe,permissions(type,role)",
      );
      if (
        file.trashed ||
        !file.ownedByMe ||
        !file.parents?.includes(this.connection.folder_id) ||
        !file.permissions?.length ||
        file.permissions.some((p) => p.type !== "user" || p.role !== "owner")
      )
        throw new CoordinationError(
          "An original attachment is missing or shared. Originals retained for review.",
          409,
        );
      attachments.push(file);
    }
    const report =
      "# " +
      job.fields.title +
      "\n\n" +
      Object.entries(job.accepted || job.fields)
        .filter(([, v]) => v)
        .map(([k, v]) => k + ": " + v)
        .join("\n\n") +
      "\n\n## Field observations\n\n" +
      notes
        .map(
          (n) =>
            n.area +
            ": " +
            n.text +
            (n.audioUrl ? "\nOriginal audio reference: " + n.audioUrl : ""),
        )
        .join("\n\n");
    const body = stableJSON({
      kind: "streamlion.client.archive",
      version: 1,
      report,
      job,
      history,
      projects: records,
      observations: notes,
      attachments,
      retention:
        "Original Google records and attachment files retained; no compaction performed.",
    });
    if (new TextEncoder().encode(body).length > 700000)
      throw new CoordinationError(
        "Archive exceeds the safe package size. Preserve Google history for reviewed export.",
        413,
      );
    const generated = await this.json(
      "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files",
    );
    return { body, fileId: generated.ids[0] };
  }
  async archive(job, operation, plan) {
    await this.privateFolder();
    const snapshot = await this.snapshot();
    const { body, fileId: id } = plan;
    if (!validID(id)) throw new CoordinationError("Invalid archive file.", 409);
    const checksum = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const metadataResponse = await this.callMetadata(id);
    if (!metadataResponse) {
      const boundary = "streamlion-" + crypto.randomUUID();
      const metadata = {
        id,
        name: "StreamLion " + job.id + " archive.json",
        mimeType: "application/json",
        parents: [this.connection.folder_id],
        appProperties: { streamlionArchive: operation, checksum },
      };
      await this.json(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        {
          method: "POST",
          headers: {
            "Content-Type": "multipart/related; boundary=" + boundary,
          },
          body:
            "--" +
            boundary +
            "\r\nContent-Type: application/json\r\n\r\n" +
            JSON.stringify(metadata) +
            "\r\n--" +
            boundary +
            "\r\nContent-Type: application/json\r\n\r\n" +
            body +
            "\r\n--" +
            boundary +
            "--",
        },
      );
    }
    const response = await this.call(
      "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media",
    );
    const saved = await boundedText(response, 8 * 1024 * 1024);
    if (saved !== body)
      throw new CoordinationError(
        "Archive integrity could not be verified. Originals retained.",
        409,
      );
    if (!snapshot.rows[3].some((r) => r[0] === job.id && r[2] === id))
      await this.append("ArchiveIndex", [job.id, job.closedAt, id, 1]);
    const verifiedIndex = await this.snapshot();
    if (
      !verifiedIndex.rows[3].some(
        (r) =>
          r[0] === job.id &&
          String(r[1]) === String(job.closedAt) &&
          r[2] === id &&
          String(r[3]) === "1",
      )
    )
      throw new CoordinationError(
        "Archive pointer is unverified. Originals retained for retry.",
        503,
      );
    return id;
  }
  async callMetadata(id) {
    const capacity = await reserveGoogleRequest(
      this.env.GOOGLE_SESSIONS,
      this.connection.google_subject,
      "GET",
    );
    if (!capacity.allowed)
      throw new CoordinationError("Google is busy. Retry shortly.", 429);
    const response = await googleFetch(
      "https://www.googleapis.com/drive/v3/files/" +
        id +
        "?fields=id,size,parents,trashed,permissions(type,role)",
      { headers: { Authorization: "Bearer " + (await this.token()) } },
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new CoordinationError("File verification is unavailable.", 503);
    const file = await response.json();
    if (
      file.trashed ||
      !file.parents?.includes(this.connection.folder_id) ||
      !file.permissions?.length ||
      file.permissions.some((p) => p.type !== "user" || p.role !== "owner")
    )
      throw new CoordinationError("File privacy needs review.", 409);
    return file;
  }
  async upload(plan) {
    await this.privateFolder();
    const { attachment: a, content } = plan,
      bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
    if (!validID(a.driveId))
      throw new CoordinationError("Invalid attachment identity.");
    const existing = await this.callMetadata(a.driveId);
    if (existing && Number(existing.size) !== bytes.length)
      throw new CoordinationError(
        "Attachment content changed. Stop for review.",
        409,
      );
    if (!existing) {
      const boundary = "streamlion-" + crypto.randomUUID();
      const start = new TextEncoder().encode(
        "--" +
          boundary +
          "\r\nContent-Type: application/json\r\n\r\n" +
          JSON.stringify({
            id: a.driveId,
            name: a.name,
            mimeType: a.type,
            parents: [this.connection.folder_id],
          }) +
          "\r\n--" +
          boundary +
          "\r\nContent-Type: " +
          a.type +
          "\r\n\r\n",
      );
      const end = new TextEncoder().encode("\r\n--" + boundary + "--");
      const body = new Uint8Array(start.length + bytes.length + end.length);
      body.set(start);
      body.set(bytes, start.length);
      body.set(end, start.length + bytes.length);
      await this.json(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        {
          method: "POST",
          headers: {
            "Content-Type": "multipart/related; boundary=" + boundary,
          },
          body,
        },
      );
    }
    const response = await this.call(
      "https://www.googleapis.com/drive/v3/files/" + a.driveId + "?alt=media",
    );
    if (Number(response.headers.get("Content-Length")) > 512 * 1024)
      throw new CoordinationError("Attachment verification failed.", 409);
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512 * 1024) {
        await reader.cancel();
        throw new CoordinationError(
          "Attachment exceeds the verification limit.",
          413,
        );
      }
      chunks.push(value);
    }
    const saved = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      saved.set(chunk, offset);
      offset += chunk.length;
    }
    if (saved.length !== bytes.length || saved.some((v, i) => v !== bytes[i]))
      throw new CoordinationError(
        "Attachment verification failed. Original upload retained for retry.",
        409,
      );
  }
}
