import { googleFetch, seal, unseal } from "./google-auth.js";
import { reserveGoogleRequest } from "./google-limits.js";
import { boundedText, boundedBytes } from "./request-body.js";
import {
  ARCHIVE_KIND,
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MAX_FILE_BYTES,
  ARCHIVE_MAX_TOTAL_BYTES,
  archiveID,
  archiveReferences,
  archiveReports,
  validateArchive,
  archiveImportRecords,
  sha256Hex,
} from "./coordination-archive.js";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  rowFor,
  readRecordHistory,
} from "../src/workbook.js";
import { stableJSON, CoordinationError } from "../src/client-workflow.js";
import { coordinationMetric } from "./coordination-runtime.js";
import {
  isIntakeTemplate,
  validateIntakeRecord,
} from "../src/intake-templates.js";
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
    await this.privateWorkbook();
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
  async privateWorkbook() {
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
  }
  async snapshot() {
    const started = Date.now();
    try {
      const snapshot = await this.readSnapshot();
      coordinationMetric(this.env, {
        metric: "google-snapshot",
        elapsedMs: Date.now() - started,
        rowCounts: snapshot.rows.map((r) => Math.max(0, r.length - 1)),
        failed: false,
      });
      return snapshot;
    } catch (error) {
      coordinationMetric(this.env, {
        metric: "google-snapshot",
        elapsedMs: Date.now() - started,
        failed: true,
      });
      throw error;
    }
  }
  async readSnapshot() {
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
      if (event.job.kind !== undefined) {
        if (
          !isIntakeTemplate(event.job) ||
          event.actor !== "provider" ||
          event.action !== "template-save"
        )
          throw new CoordinationError("Invalid service template history.", 409);
        validateIntakeRecord(event.job);
      }
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
      if (
        chain.some(
          (e, i) =>
            e.revision !== i ||
            e.parent !== i - 1 ||
            e.job.kind !== chain[0].job.kind,
        )
      )
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
    const templates = new Map(
      [...heads].filter(([, record]) => isIntakeTemplate(record)),
    );
    for (const id of templates.keys()) heads.delete(id);
    return { rows, projects, notes, events, heads, templates };
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
    if (
      ((snapshot.heads.get(event.jobId) || snapshot.templates.get(event.jobId))
        ?.revision ?? -1) !== event.parent
    )
      throw new CoordinationError(
        "This job changed before saving. Review its history.",
        409,
      );
    if (snapshot.rows[2].length >= 10000)
      throw new CoordinationError(
        "Workbook history reached its limit. Stop for a reviewed workbook rollover; archiving retains the original rows.",
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
    if (!this.env.GOOGLE_TOKEN_ENCRYPTION_KEY)
      throw new CoordinationError(
        "Coordination signing configuration is unavailable.",
        503,
      );
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
  async archivePlan(job, snapshot) {
    await this.privateFolder();
    snapshot ||= await this.snapshot();
    const history = [...snapshot.events.values()].filter(
      (e) => e.jobId === job.id,
    );
    const records = snapshot.projects.revisions.filter(
      (r) => r.recordId === job.id,
    );
    const notes = snapshot.notes.revisions.filter(
      (r) => r.projectId === job.id,
    );
    const refs = archiveReferences(job, notes),
      originals = [],
      budget = { bytes: 0 };
    for (const [id, references] of refs.files)
      originals.push(await this.originalFile(id, references, job, budget));
    const payload = {
      kind: ARCHIVE_KIND,
      version: 2,
      source: {
        workbookId: this.connection.workbook_id,
        folderId: this.connection.folder_id,
        provider: this.connection.google_subject,
        mode: this.connection.mode,
      },
      reports: archiveReports(job, notes, this.connection.client_brand),
      job,
      history: history.sort((a, b) => a.revision - b.revision),
      projects: records,
      observations: notes,
      originals,
      externalReferences: refs.external,
      retention:
        "Original Google records and Drive files retained; no compaction performed. External links are references only.",
    };
    validateArchive(payload);
    const digest = await sha256Hex(stableJSON(payload));
    const body = stableJSON({
      ...payload,
      integrity: {
        digest,
        signature: await this.signature({
          kind: ARCHIVE_KIND,
          version: 2,
          digest,
        }),
      },
    });
    if (new TextEncoder().encode(body).length > ARCHIVE_MAX_BYTES)
      throw new CoordinationError(
        "Archive exceeds the safe package size. Preserve Google history for reviewed export.",
        413,
      );
    const generated = await this.json(
      "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files",
    );
    if (!validID(generated.ids?.[0]))
      throw new CoordinationError("Invalid archive file identity.", 503);
    return { body, fileId: generated.ids[0] };
  }
  async archive(job, operation, plan) {
    await this.privateFolder();
    const snapshot = await this.snapshot();
    const { body, fileId: id } = plan;
    if (!validID(id)) throw new CoordinationError("Invalid archive file.", 409);
    // Preserve recovery of already-journaled v1 archives without treating their
    // unsigned contents as authorization to import into another workbook.
    const version = JSON.parse(body).version;
    if (![1, 2].includes(version))
      throw new CoordinationError("Unsupported archive version.", 409);
    const checksum = await sha256Hex(body);
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
    const saved = await boundedText(response, ARCHIVE_MAX_BYTES);
    if (saved !== body)
      throw new CoordinationError(
        "Archive integrity could not be verified. Originals retained.",
        409,
      );
    if (!snapshot.rows[3].some((r) => r[0] === job.id && r[2] === id))
      await this.append("ArchiveIndex", [job.id, job.closedAt, id, version]);
    const verifiedIndex = await this.snapshot();
    if (
      !verifiedIndex.rows[3].some(
        (r) =>
          r[0] === job.id &&
          String(r[1]) === String(job.closedAt) &&
          r[2] === id &&
          String(r[3]) === String(version),
      )
    )
      throw new CoordinationError(
        "Archive pointer is unverified. Originals retained for retry.",
        503,
      );
    return id;
  }
  async originalMetadata(id) {
    if (!archiveID(id))
      throw new CoordinationError("Invalid original file identity.", 409);
    const file = await this.json(
      "https://www.googleapis.com/drive/v3/files/" +
        id +
        "?fields=id,name,mimeType,size,parents,trashed,ownedByMe,appProperties,permissions(type,role)",
    );
    if (
      file.id !== id ||
      file.trashed ||
      !file.ownedByMe ||
      !file.permissions?.length ||
      file.permissions.some((p) => p.type !== "user" || p.role !== "owner")
    )
      throw new CoordinationError(
        "An original file is missing or shared. Original records retained for review.",
        409,
      );
    return file;
  }
  async originalFile(id, references, job, budget, expected) {
    const file = await this.originalMetadata(id);
    let parent = file.parents?.length === 1 ? file.parents[0] : "";
    for (
      let depth = 0;
      parent && parent !== this.connection.folder_id && depth < 3;
      depth++
    ) {
      const folder = await this.originalMetadata(parent);
      if (folder.mimeType !== "application/vnd.google-apps.folder") break;
      parent = folder.parents?.length === 1 ? folder.parents[0] : "";
    }
    const bytes = Number(file.size);
    if (
      parent !== this.connection.folder_id ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > ARCHIVE_MAX_FILE_BYTES ||
      budget.bytes + bytes > ARCHIVE_MAX_TOTAL_BYTES
    )
      throw new CoordinationError(
        "Original file location or verification capacity needs review. Original records retained.",
        409,
      );
    for (const ref of references) {
      if (ref.kind === "attachment") {
        const a = job.attachments.find(
          (a) => a.id === ref.id && a.driveId === id,
        );
        if (
          !a ||
          bytes !== a.bytes ||
          file.mimeType !== a.type ||
          file.parents?.[0] !== this.connection.folder_id ||
          file.appProperties?.streamlionUpload !== a.id
        )
          throw new CoordinationError(
            "Original attachment identity changed. Original records retained.",
            409,
          );
      } else if (
        ref.kind !== "field" ||
        file.appProperties?.streamlionNote !== ref.id ||
        file.appProperties?.streamlionProject !== job.id ||
        !archiveID(file.appProperties?.streamlionBook)
      )
        throw new CoordinationError(
          "Original field file identity needs review. Original records retained.",
          409,
        );
    }
    budget.bytes += bytes;
    const content = await boundedBytes(
      await this.call(
        "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media",
      ),
      ARCHIVE_MAX_FILE_BYTES,
    );
    const digest = await sha256Hex(content);
    if (
      content.length !== bytes ||
      (references.some((r) => r.kind === "field") &&
        file.appProperties?.sha256 !== digest) ||
      job.attachments.some(
        (a) => a.driveId === id && a.sha256 && a.sha256 !== digest,
      )
    )
      throw new CoordinationError(
        "Original file bytes changed. Original records retained for review.",
        409,
      );
    const result = {
      id,
      name: file.name,
      type: file.mimeType,
      bytes,
      sha256: digest,
      references,
    };
    if (expected && stableJSON(expected) !== stableJSON(result))
      throw new CoordinationError(
        "An archived original changed or is unavailable. Original records retained for review.",
        409,
      );
    return result;
  }
  async verifyArchive(archive) {
    if (archive?.kind !== ARCHIVE_KIND || archive.version !== 2)
      throw new CoordinationError(
        "Legacy archive recovery requires review of the original workbook.",
        409,
      );
    const { integrity, ...payload } = archive;
    if (
      !archiveID(payload.source?.workbookId) ||
      payload.source?.provider !== this.connection.google_subject ||
      payload.source?.mode !== this.connection.mode ||
      payload.source?.folderId !== this.connection.folder_id ||
      !/^[a-f0-9]{64}$/.test(integrity?.digest || "") ||
      integrity.digest !== (await sha256Hex(stableJSON(payload)))
    )
      throw new CoordinationError(
        "Archive ownership or integrity could not be verified. Original records retained.",
        409,
      );
    const signer = new CoordinationGoogle(this.env, {
      ...this.connection,
      workbook_id: payload.source.workbookId,
    });
    if (
      !(await signer.signature(
        { kind: ARCHIVE_KIND, version: 2, digest: integrity.digest },
        integrity.signature,
      ))
    )
      throw new CoordinationError(
        "Archive signature could not be verified. Original records retained.",
        409,
      );
    validateArchive(archive);
    return archive;
  }
  async loadArchive(id) {
    await this.privateFolder();
    const metadata = await this.originalMetadata(id);
    if (
      metadata.mimeType !== "application/json" ||
      !metadata.parents?.includes(this.connection.folder_id) ||
      !Number.isSafeInteger(Number(metadata.size)) ||
      Number(metadata.size) > ARCHIVE_MAX_BYTES ||
      !archiveID(metadata.appProperties?.streamlionArchive)
    )
      throw new CoordinationError(
        "Choose a private StreamLion archive in this workspace's original Drive folder.",
        409,
      );
    const body = await boundedText(
      await this.call(
        "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media",
      ),
      ARCHIVE_MAX_BYTES,
    );
    if (
      new TextEncoder().encode(body).length !== Number(metadata.size) ||
      metadata.appProperties?.checksum !== (await sha256Hex(body))
    )
      throw new CoordinationError(
        "Archive checksum could not be verified. Original records retained.",
        409,
      );
    let archive;
    try {
      archive = JSON.parse(body);
    } catch {
      throw new CoordinationError("Invalid archive package.", 409);
    }
    return this.verifyArchive(archive);
  }
  async importArchive(plan, operation) {
    const { archive, fileId, at } = plan;
    await this.verifyArchive(archive);
    await this.privateFolder();
    await this.privateWorkbook();
    const budget = { bytes: 0 };
    for (const f of archive.originals)
      await this.originalFile(f.id, f.references, archive.job, budget, f);
    const imported = archiveImportRecords(archive, operation, at);
    const values = [
      imported.projects.map((r) => rowFor(r, PROJECT_HEADERS)),
      imported.notes.map((r) => rowFor(r, NOTE_HEADERS)),
      await Promise.all(
        imported.events.map(async (e) => [
          e.id,
          e.jobId,
          e.revision,
          e.parent,
          e.at,
          e.actor,
          e.action,
          stableJSON(e.job),
          await this.signature(e),
        ]),
      ),
      [[archive.job.id, archive.job.closedAt, fileId, 2]],
    ];
    const check = (snapshot) => {
      const noteIDs = new Set(imported.notes.map((r) => r.recordId));
      const relevant = snapshot.rows.map((rows, i) =>
        rows
          .slice(1)
          .filter((r) =>
            i === 0
              ? r[0] === archive.job.id || values[0].some((v) => v[1] === r[1])
              : i === 1
                ? noteIDs.has(r[0]) ||
                  r[5] === archive.job.id ||
                  values[1].some((v) => v[1] === r[1])
                : i === 2
                  ? r[1] === archive.job.id ||
                    values[2].some((v) => v[0] === r[0])
                  : r[0] === archive.job.id,
          ),
      );
      if (!relevant.some((r) => r.length)) return false;
      const headers = [
        PROJECT_HEADERS,
        NOTE_HEADERS,
        EVENT_HEADERS,
        ARCHIVE_HEADERS,
      ];
      const strings = (rows, tab) =>
        stableJSON(
          rows
            .map((r) => {
              if (
                r.slice(headers[tab].length).some((v) => v !== "" && v != null)
              )
                throw new CoordinationError(
                  "Archive recovery has unexpected columns. Preserve the workbook for review.",
                  409,
                );
              // Sheets values reads omit trailing empty cells. Compare every
              // declared column so omitted blanks do not resemble a partial write.
              return headers[tab].map((_, i) => String(r[i] ?? ""));
            })
            .sort((a, b) => stableJSON(a).localeCompare(stableJSON(b))),
        );
      if (
        relevant.some((rows, i) => strings(rows, i) !== strings(values[i], i))
      )
        throw new CoordinationError(
          "Archive restore is partial or conflicts with existing records. Preserve the workbook for review.",
          409,
        );
      return true;
    };
    const before = await this.snapshot();
    if (check(before)) return imported.job;
    const merged = before.rows.map((rows, i) => [...rows, ...values[i]]);
    if (
      merged.some((rows) => rows.length > 10000) ||
      new TextEncoder().encode(
        stableJSON({ valueRanges: merged.map((values) => ({ values })) }),
      ).length >
        7 * 1024 * 1024
    )
      throw new CoordinationError(
        "This workbook has insufficient recovery capacity. Choose a new compatible workbook; originals are retained.",
        409,
      );
    const book = await this.json(this.sheet("?fields=sheets.properties"));
    const names = [
      "Projects",
      "Observations",
      "CoordinationEvents",
      "ArchiveIndex",
    ];
    const ids = names.map(
      (name) =>
        book.sheets?.find((s) => s.properties.title === name)?.properties
          .sheetId,
    );
    if (ids.some((id) => !Number.isSafeInteger(id)) || new Set(ids).size !== 4)
      throw new CoordinationError(
        "Workbook recovery tabs changed. Stop for review.",
        409,
      );
    // One atomic append batch. Explicit ranges could overwrite a manual append.
    await this.json(this.sheet(":batchUpdate"), {
      method: "POST",
      body: JSON.stringify({
        requests: values.flatMap((rows, i) =>
          rows.length
            ? [
                {
                  appendCells: {
                    sheetId: ids[i],
                    fields: "userEnteredValue",
                    rows: rows.map((r) => ({
                      values: r.map((v) => ({
                        userEnteredValue: { stringValue: String(v ?? "") },
                      })),
                    })),
                  },
                },
              ]
            : [],
        ),
      }),
    });
    if (!check(await this.snapshot()))
      throw new CoordinationError(
        "Archive restore is unverified. Retry the original operation.",
        503,
      );
    return imported.job;
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
