import { accessToken, googleFetch, hash, seal, unseal } from "./google-auth.js";
import { reserveGoogleRequest } from "./google-limits.js";
import { ExtensionError, randomToken } from "./extension-auth.js";
import { FIELD_KEYS, validateFields } from "../src/project-schema.js";
import {
  TABS,
  readRecordHistory,
  makeRevision,
  rowFor,
  columnName,
  assertUnchanged,
  validateNote,
  validateRevision,
  toLocalProject,
  toLocalNote,
} from "../src/workbook.js";
import {
  measurementSet,
  parseMeasurements,
  MEASUREMENT_KIND,
  readMeasurement,
  measurementNeedsReview,
} from "../src/measurements.js";
import { boundedText, RequestBodyError } from "./request-body.js";
import { validateWorkflow, WORKFLOW_AREA } from "../src/workflow.js";
import { managedAppend } from "./coordination-engine.js";

// The OAuth grant selects the sole workbook. No tool accepts a workbook, URL,
// account, token, Drive search query, or arbitrary Google request path.
async function request(env, principal, path, method = "GET", data) {
  const { session, bookId } = principal;
  if (!/^[\w-]{1,200}$/.test(bookId))
    throw new ExtensionError(
      "Choose a valid StreamLion workbook before connecting.",
    );
  if (method === "POST" && path.includes(":append")) {
    try {
      const managed = await managedAppend(
        env,
        session,
        `https://sheets.googleapis.com/v4/spreadsheets/${bookId}${path}`,
        JSON.stringify(data),
      );
      if (managed) return managed;
    } catch (error) {
      throw new ExtensionError(error.message, error.status || 503);
    }
  }
  const capacity = await reserveGoogleRequest(
    env.GOOGLE_SESSIONS,
    session.google_subject,
    method,
  );
  if (!capacity.allowed)
    throw new ExtensionError(
      "Google is busy. Wait a minute, then retry. Your draft is kept.",
      429,
    );
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${bookId}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken(env, session)}`,
        "Content-Type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    },
  );
  if (!response.ok) {
    if ([401, 403, 404].includes(response.status))
      throw new ExtensionError(
        "This workbook is no longer accessible. Check Connections in the browser workspace, then reconnect the extension.",
        403,
      );
    throw new ExtensionError(
      "Google could not complete this request. Retry with the same draft.",
      503,
    );
  }
  try {
    return JSON.parse(await boundedText(response, 8 * 1024 * 1024));
  } catch (error) {
    if (error instanceof RequestBodyError && error.status === 413)
      throw new ExtensionError(
        "This workbook response is too large for the extension. Your records are unchanged. Open the browser workspace and review archival options.",
        413,
      );
    throw new ExtensionError(
      "Google returned an unreadable response. Please retry.",
      503,
    );
  }
}
export async function extensionSnapshot(env, principal) {
  const meta = await request(
    env,
    principal,
    "?fields=properties(title),sheets(properties)",
  );
  const ranges = Object.keys(TABS).map((name) => {
    const p = meta.sheets?.find((s) => s.properties.title === name)?.properties;
    if (
      !p ||
      !Number.isInteger(p.gridProperties?.rowCount) ||
      p.gridProperties.rowCount < 1 ||
      p.gridProperties.rowCount > 10000
    )
      throw new ExtensionError(
        "Choose a StreamLion workbook with Projects and Observations tabs, each within 10,000 rows.",
      );
    return `${name}!1:${p.gridProperties.rowCount}`;
  });
  const params = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  for (const range of ranges) params.append("ranges", range);
  const response = await request(env, principal, `/values:batchGet?${params}`);
  const heads = {},
    history = {},
    rows = {};
  Object.entries(TABS).forEach(([tab, headers], i) => {
    const values = response.valueRanges?.[i]?.values || [];
    const parsed = readRecordHistory(values, headers);
    heads[tab] = parsed.heads;
    history[tab] = parsed.revisions;
    rows[tab] = values.length;
  });
  return {
    heads,
    history,
    rows,
    title: meta.properties?.title || "StreamLion workbook",
    asOf: new Date().toISOString(),
  };
}
const active = (r) => r.reviewState !== "archived";
function projectIn(snapshot, recordId) {
  const p = snapshot.heads.Projects.find(
    (r) => r.recordId === recordId && active(r),
  );
  if (!p)
    throw new ExtensionError(
      "This project was not found in your connected workbook. Refresh the project list.",
      404,
    );
  return p;
}
export function extensionDestination(principal, snapshot) {
  return {
    title: snapshot.title,
    workbookUrl: `https://docs.google.com/spreadsheets/d/${principal.bookId}/edit`,
    asOf: snapshot.asOf,
  };
}
export async function listExtensionProjects(env, principal) {
  const snapshot = await extensionSnapshot(env, principal);
  return {
    kind: "projects",
    destination: extensionDestination(principal, snapshot),
    projects: snapshot.heads.Projects.filter(active).map((p) => ({
      recordId: p.recordId,
      revisionId: p.revisionId,
      title: p.title,
      city: p.city,
      date: p.startLocal,
      reviewState: p.reviewState,
    })),
  };
}
export async function getExtensionProject(env, principal, recordId) {
  const snapshot = await extensionSnapshot(env, principal),
    project = projectIn(snapshot, recordId);
  return {
    kind: "project",
    destination: extensionDestination(principal, snapshot),
    project: toLocalProject(project),
    notes: snapshot.heads.Observations.filter(
      (n) => n.projectId === recordId,
    ).map(toLocalNote),
  };
}
function requireWriting(principal) {
  if (!principal.grant.scope.split(" ").includes("records.write"))
    throw new ExtensionError(
      "Reconnect with permission to prepare and save changes.",
      403,
    );
}
export async function prepareExtensionDraft(env, principal, input) {
  requireWriting(principal);
  const snapshot = await extensionSnapshot(env, principal);
  let expected, fields, tab, project;
  if (input.kind === "project") {
    expected = input.recordId ? projectIn(snapshot, input.recordId) : undefined;
    if ((expected?.revisionId || "") !== (input.expectedRevisionId || ""))
      throw new ExtensionError(
        "The project changed. Read it again before preparing changes.",
        409,
      );
    fields = validateFields({
      ...Object.fromEntries(FIELD_KEYS.map((k) => [k, expected?.[k] || ""])),
      ...input.fields,
    });
    tab = "Projects";
  } else {
    project = projectIn(snapshot, input.projectId);
    expected = input.recordId
      ? snapshot.heads.Observations.find(
          (n) =>
            n.recordId === input.recordId && n.projectId === input.projectId,
        )
      : undefined;
    if (input.recordId && !expected)
      throw new ExtensionError("The field record was not found.", 404);
    if ((expected?.revisionId || "") !== (input.expectedRevisionId || ""))
      throw new ExtensionError(
        "The field record changed. Read it again before preparing changes.",
        409,
      );
    let text = input.text;
    let area = input.area;
    if (input.kind === "measurement") {
      const parsed = parseMeasurements(input.raw);
      const set = measurementSet({
        kind: MEASUREMENT_KIND,
        version: 1,
        room: input.room.trim(),
        floor: input.floor || "",
        side: input.side || "Interior",
        enteredAt: new Date().toISOString(),
        raw: input.raw,
        ...parsed,
      });
      text = JSON.stringify(set);
      area = `Measurements · ${set.room}`;
    }
    if (input.kind === "workflow") {
      text = JSON.stringify(validateWorkflow(input.plan));
      area = WORKFLOW_AREA;
    }
    fields = validateNote({
      projectId: project.recordId,
      area,
      text,
      sourceText: expected?.sourceText || input.sourceText || text,
      audioUrl: expected?.audioUrl || "",
    });
    // Plain notes may not impersonate reserved, structured workflow/measurement records.
    if (
      input.kind === "note" &&
      (area === WORKFLOW_AREA ||
        readMeasurement({ text, sourceText: fields.sourceText }))
    )
      throw new ExtensionError(
        "Use the measurement or checklist action for structured records.",
      );
    if (input.kind === "workflow") {
      const existing = snapshot.heads.Observations.filter(
        (n) => n.projectId === project.recordId && n.area === WORKFLOW_AREA,
      );
      if (
        existing.length > 1 ||
        (existing[0] && existing[0].recordId !== input.recordId)
      )
        throw new ExtensionError(
          "Read and update the existing checklist instead of creating another.",
          409,
        );
    }
    tab = "Observations";
  }
  const revision = makeRevision(fields, expected);
  validateRevision(revision, TABS[tab]);
  const draftId = crypto.randomUUID(),
    confirmation = randomToken();
  const payload = {
    kind: input.kind,
    tab,
    revision,
    expected: expected || null,
    projectRevisionId: project?.revisionId || "",
  };
  const expiresAt = Date.now() + 86400000;
  // Bound each grant to at most 30 pending review copies; no unlimited draft storage.
  await env.GOOGLE_SESSIONS.prepare(
    "DELETE FROM streamlion_extension_drafts_v1 WHERE expires_at <= ?",
  )
    .bind(Date.now())
    .run();
  const inserted = await env.GOOGLE_SESSIONS.prepare(
    `INSERT INTO streamlion_extension_drafts_v1
    SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM streamlion_extension_drafts_v1 WHERE grant_id = ?) < 30`,
  )
    .bind(
      draftId,
      principal.grant.grant_id,
      await hash(confirmation),
      await seal(env, payload, `extension-draft:${draftId}`),
      expiresAt,
      principal.grant.grant_id,
    )
    .run();
  if (!inserted.meta.changes)
    throw new ExtensionError(
      "There are 30 pending drafts. Review them or wait for old drafts to expire.",
      429,
    );
  return {
    structuredContent: {
      kind: "draft",
      draftId,
      recordType: input.kind,
      revision,
      destination: extensionDestination(principal, snapshot),
      expiresAt: new Date(expiresAt).toISOString(),
    },
    // Host forwards _meta to the view, not the model. The app-only save tool
    // requires this unguessable key as well as the bound OAuth grant.
    _meta: { confirmation, expectedRevisionId: expected?.revisionId || "" },
  };
}
export async function getExtensionDraft(env, principal, draftId) {
  const row = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_extension_drafts_v1 WHERE draft_id = ? AND grant_id = ? AND expires_at > ?",
  )
    .bind(draftId, principal.grant.grant_id, Date.now())
    .first();
  if (!row)
    throw new ExtensionError(
      "This review copy expired. Check the project in your browser workspace for a saved revision before preparing it again.",
      404,
    );
  const payload = await unseal(env, row.payload, `extension-draft:${draftId}`);
  return { row, payload };
}
function savedRevision(snapshot, tab, revision) {
  const prior = snapshot.history[tab].find(
    (r) => r.revisionId === revision.revisionId,
  );
  if (
    prior &&
    JSON.stringify(rowFor(prior, TABS[tab])) !==
      JSON.stringify(rowFor(revision, TABS[tab]))
  )
    throw new ExtensionError(
      "A revision identity has conflicting content. Review the workbook history.",
      409,
    );
  return !!prior;
}
export async function saveExtensionDraft(
  env,
  principal,
  { draftId, confirmation, reviewed },
) {
  requireWriting(principal);
  const loaded = await getExtensionDraft(env, principal, draftId);
  const { row } = loaded;
  let payload = loaded.payload;
  if (
    typeof confirmation !== "string" ||
    (await hash(confirmation)) !== row.confirmation_hash
  )
    throw new ExtensionError(
      "Open this review in the StreamLion workspace before saving.",
      403,
    );
  if (typeof reviewed !== "boolean")
    throw new ExtensionError("Choose a save state before continuing.");
  const revision = {
    ...payload.revision,
    reviewState: reviewed ? "reviewed" : "draft",
  };
  if (
    reviewed &&
    payload.kind === "measurement" &&
    measurementNeedsReview({ text: revision.text })
  )
    throw new ExtensionError(
      "Clarify every reading before marking it checked against the tape.",
    );
  // Retain the user's first save choice and revision across unknown outcomes.
  // Retries cannot reuse a revision identity with a different review state.
  if (payload.saveReview !== undefined && payload.saveReview !== reviewed)
    throw new ExtensionError(
      "Retry the same save choice first, then make a new correction.",
      409,
    );
  const owner = crypto.randomUUID();
  const lease = await env.GOOGLE_SESSIONS.prepare(
    `INSERT INTO streamlion_extension_locks_v1 VALUES (?, ?, ?)
    ON CONFLICT(workbook_id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at
    WHERE streamlion_extension_locks_v1.expires_at <= ?`,
  )
    .bind(principal.bookId, owner, Date.now() + 180000, Date.now())
    .run();
  if (!lease.meta.changes)
    throw new ExtensionError(
      "Another save is in progress. Retry this same draft shortly.",
      409,
    );
  try {
    const latest = await getExtensionDraft(env, principal, draftId);
    if (
      latest.payload.saveReview !== undefined &&
      latest.payload.saveReview !== reviewed
    )
      throw new ExtensionError("Retry the same save choice first.", 409);
    payload = latest.payload;
    payload.saveReview = reviewed;
    await env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_extension_drafts_v1 SET payload = ? WHERE draft_id = ? AND grant_id = ?",
    )
      .bind(
        await seal(env, payload, `extension-draft:${draftId}`),
        draftId,
        principal.grant.grant_id,
      )
      .run();
    const before = await extensionSnapshot(env, principal);
    if (!savedRevision(before, payload.tab, revision)) {
      const rejectBeforeWrite = async (message) => {
        const error = new ExtensionError(message, 409);
        error.safeToEdit = !payload.writeAttempted;
        if (error.safeToEdit) {
          delete payload.saveReview;
          await env.GOOGLE_SESSIONS.prepare(
            "UPDATE streamlion_extension_drafts_v1 SET payload = ? WHERE draft_id = ? AND grant_id = ?",
          )
            .bind(
              await seal(env, payload, `extension-draft:${draftId}`),
              draftId,
              principal.grant.grant_id,
            )
            .run();
        }
        return error;
      };
      if (before.rows[payload.tab] >= 10000)
        throw await rejectBeforeWrite(
          "The workbook is full. Your draft is kept.",
        );
      try {
        assertUnchanged(
          before.heads[payload.tab].find(
            (r) => r.recordId === revision.recordId,
          ),
          payload.expected,
        );
      } catch {
        throw await rejectBeforeWrite(
          "The record changed in Google. Load its latest version before preparing your changes again.",
        );
      }
      if (payload.tab === "Observations") {
        const project = projectIn(before, revision.projectId);
        if (project.revisionId !== payload.projectRevisionId)
          throw await rejectBeforeWrite(
            "The project brief changed. Review the field record against it again.",
          );
      }
      // Verify lease immediately before mutation. PWA/external concurrent writes
      // are still detected by the shared append-only history rules, not overwritten.
      const held = await env.GOOGLE_SESSIONS.prepare(
        "SELECT owner FROM streamlion_extension_locks_v1 WHERE workbook_id = ? AND expires_at > ?",
      )
        .bind(principal.bookId, Date.now())
        .first();
      if (held?.owner !== owner)
        throw new ExtensionError(
          "The save expired. Retry the same draft.",
          409,
        );
      const range = encodeURIComponent(
        `${payload.tab}!A:${columnName(TABS[payload.tab].length - 1)}`,
      );
      // Record intent BEFORE the network mutation. No later preflight failure
      // may unlock a copy whose earlier append could have succeeded remotely.
      payload.writeAttempted = true;
      await env.GOOGLE_SESSIONS.prepare(
        "UPDATE streamlion_extension_drafts_v1 SET payload = ? WHERE draft_id = ? AND grant_id = ?",
      )
        .bind(
          await seal(env, payload, `extension-draft:${draftId}`),
          draftId,
          principal.grant.grant_id,
        )
        .run();
      await request(
        env,
        principal,
        `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        "POST",
        { values: [rowFor(revision, TABS[payload.tab])] },
      );
    }
    const after = await extensionSnapshot(env, principal);
    if (!savedRevision(after, payload.tab, revision))
      throw new ExtensionError(
        "Google has not confirmed the save. Retry this same draft; do not recreate it.",
        503,
      );
    return {
      kind: "saved",
      recordId: revision.recordId,
      projectId:
        payload.tab === "Projects" ? revision.recordId : revision.projectId,
      revisionId: revision.revisionId,
      destination: extensionDestination(principal, after),
    };
  } finally {
    await env.GOOGLE_SESSIONS.prepare(
      "DELETE FROM streamlion_extension_locks_v1 WHERE workbook_id = ? AND owner = ?",
    )
      .bind(principal.bookId, owner)
      .run();
  }
}
