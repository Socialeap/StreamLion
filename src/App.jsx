import {
  readDraft,
  writeDraft,
  clearDraft,
  clearSavedDraft,
  listProjectDrafts,
  projectDraftKey,
} from "./drafts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { updateReady, subscribeUpdate, applyUpdate } from "./updates.js";
import {
  FileText,
  NotebookPen,
  Link,
  MessageCircle,
  Ruler,
} from "lucide-react";
import Jobs from "./Jobs";
import Notes from "./Notes";
import Measurements from "./MeasurementCapture.jsx";
import ProjectEditor from "./ProjectEditor";
import Connections from "./Connections";
import ChatGPTPanel from "./ChatGPTPanel";
import ProjectHome from "./ProjectHome";
import {
  WORKFLOW_AREA,
  readWorkflow,
  workflowNote,
  reusableFields,
  validateWorkflow,
} from "./workflow";
import { newFieldRecord, sendFieldRecord } from "./field-records";
import { emptyWorkspace, reviseNote } from "./model";
import {
  loadWorkspace,
  saveWorkspace,
  saveAudioNote,
  download,
  getAudio,
  loadSiteCopy,
  saveSiteCopy,
  removeSiteCopy,
} from "./storage";
import {
  readWorkbook,
  restoreGoogleSession,
  rememberGoogleWorkbook,
  appendRevision,
  hasGoogleSession,
  reserveFieldFileId,
  retainFieldFile,
} from "./google";
import { makeRevision, toLocalNote, validateNote } from "./workbook";
import { legacyFields, PROJECT_FIELDS } from "./project-schema";
import {
  assertSaveDestination,
  noteControlsFor,
  visibleProjects,
} from "./project-routing";
const selectedWorkbookKey = "streamlion-selected-workbook-v1";
function rememberedWorkbook() {
  try {
    return localStorage.getItem(selectedWorkbookKey) || "";
  } catch {
    return "";
  }
}
export default function App() {
  const newerVersion = useSyncExternalStore(subscribeUpdate, updateReady);
  const [local, setLocal] = useState(emptyWorkspace),
    current = useRef(null),
    writing = useRef(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Opening device records…");
  const [page, setPage] = useState("Projects"),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(null),
    [captureBusy, setCaptureBusy] = useState(false),
    [syncBusy, setSyncBusy] = useState(false);
  const navigation = useRef({ page, selected, editing });
  navigation.current = { page, selected, editing };
  const [bookId, setBookId] = useState(rememberedWorkbook),
    [remote, setRemote] = useState(null);
  const [siteCopy, setSiteCopy] = useState(null);
  const [verifiedAt, setVerifiedAt] = useState("");
  const [outboxBusy, setOutboxBusy] = useState(false);
  const [areaHint, setAreaHint] = useState(null);
  const cacheEnabled = useRef(false);
  const cacheLoadEpoch = useRef(0);
  const [drafts, setDrafts] = useState(() =>
    visibleDrafts(rememberedWorkbook()),
  );
  const pending = useRef(null);
  const [hasPending, setHasPending] = useState(false);
  const [noteEpoch, setNoteEpoch] = useState(0);
  const [restoreError, setRestoreError] = useState("");
  const restoreEpoch = useRef(0);
  async function restoreConnection() {
    const epoch = ++restoreEpoch.current;
    setRestoreError("");
    setStatus("Restoring Google connection…");
    try {
      const connection = await restoreGoogleSession();
      if (epoch !== restoreEpoch.current) return;
      if (!connection.enabled || !connection.connected) {
        setStatus(
          bookId ? "Selected workbook · reconnect Google" : "Device workspace",
        );
        return;
      }
      // The backend's account-scoped selection is authoritative. Never use an
      // old device-wide workbook as the destination for a new Google account.
      setBookId(connection.bookId);
      try {
        localStorage.setItem(selectedWorkbookKey, connection.bookId);
      } catch {
        /* local cache optional */
      }
      setRemote(null);
      if (connection.bookId !== bookId) setSiteCopy(null);
      refreshDrafts(connection.bookId);
      if (!connection.bookId) {
        setStatus("Google connected · choose a workbook");
        setPage("Connections");
        return;
      }
      const data = await readWorkbook(connection.bookId);
      if (epoch !== restoreEpoch.current) return;
      await connectBook(connection.bookId, data, true);
    } catch (e) {
      if (epoch === restoreEpoch.current) {
        setRestoreError(e.message);
        setStatus("Saved connection unavailable · retry in Connections");
      }
    }
  }
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("google");
    if (result === "cancelled" || result === "failed")
      setError(
        "Google sign-in was not completed. Your drafts are preserved; try again in Connections.",
      );
    if (result) window.history.replaceState(null, "", window.location.pathname);
    restoreConnection();
    return () => {
      restoreEpoch.current++;
    };
  }, []);
  useEffect(() => {
    if (!restoreError || captureBusy || syncBusy) return;
    const retry = () => restoreConnection();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [restoreError, captureBusy, syncBusy]);
  useEffect(() => {
    loadWorkspace()
      .then((w) => {
        current.current = w;
        setLocal(w);
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let current = true;
    const epoch = cacheLoadEpoch.current;
    cacheEnabled.current = false;
    setSiteCopy(null);
    loadSiteCopy(bookId)
      .then((copy) => {
        if (current && epoch === cacheLoadEpoch.current) {
          setSiteCopy(copy);
          cacheEnabled.current = !!copy;
        }
      })
      .catch((e) => {
        if (current && epoch === cacheLoadEpoch.current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [bookId]);
  async function acceptRemote(data, destination = bookId) {
    setRemote(data);
    setVerifiedAt(new Date().toISOString());
    if (cacheEnabled.current && destination === bookId) {
      try {
        const copy = await saveSiteCopy(destination, data);
        cacheLoadEpoch.current++;
        setSiteCopy(copy);
      } catch (e) {
        setError(
          `Google was verified, but its site copy could not be updated: ${e.message}`,
        );
      }
    }
  }
  async function keepSiteCopy(keep) {
    setSyncBusy(true);
    setError("");
    try {
      if (keep) {
        assertSaveDestination(bookId, remote);
        if (!hasGoogleSession())
          throw new Error("Reconnect Google to prepare a site copy.");
        const copy = await saveSiteCopy(bookId, remote);
        cacheLoadEpoch.current++;
        setSiteCopy(copy);
      } else {
        await removeSiteCopy(bookId);
        cacheLoadEpoch.current++;
        setSiteCopy(null);
      }
      cacheEnabled.current = keep;
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncBusy(false);
    }
  }
  function visibleDrafts(scope, deleted = false) {
    return [
      ...listProjectDrafts(scope || "local", { deleted }),
      ...(scope ? listProjectDrafts("local", { deleted }) : []),
    ];
  }
  function refreshDrafts(scope = bookId) {
    setDrafts(visibleDrafts(scope));
  }
  const visibleBook = remote || siteCopy?.data;
  const allProjects = visibleProjects(visibleBook, local.jobs);
  const archivedProjects = allProjects.filter(
    (project) => project.reviewState === "archived" || project.deletedAt,
  );
  const activeProjects = allProjects.filter(
    (project) => project.reviewState !== "archived" && !project.deletedAt,
  );
  const activeIds = new Set(activeProjects.map((project) => project.id));
  const workspace = {
    jobs: activeProjects,
    notes: [
      ...(visibleBook ? visibleBook.Observations.map(toLocalNote) : []),
      ...local.notes.filter(
        (note) => !note.pendingBookId || note.pendingBookId === bookId,
      ),
    ].filter((note) => activeIds.has(note.jobId)),
  };
  // A verified note may still be in the local queue if its acknowledgment was
  // interrupted. Show its local copy once, with its waiting status, until synced.
  workspace.notes = [
    ...new Map(workspace.notes.map((note) => [note.id, note])).values(),
  ];
  const waitingNotes = local.notes.filter(
    (note) => note.pendingBookId === bookId && bookId,
  );
  const templates = workspace.jobs.flatMap((project) => {
    try {
      const plan = readWorkflow(workspace.notes, project);
      return plan.templateName
        ? [{ name: plan.templateName, project, plan }]
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (selected && bookId && remote) {
      try {
        localStorage.setItem(`streamlion-last-project:${bookId}`, selected);
      } catch {
        /* optional */
      }
    }
  }, [selected, bookId, remote]);
  const active = workspace.jobs.find((j) => j.id === selected);
  const noteControls = noteControlsFor(active, bookId, remote);
  async function commit(change, audio) {
    if (writing.current) throw new Error("Another save is in progress. Retry.");
    writing.current = true;
    try {
      const next = {
        ...change(current.current),
        revision: (current.current.revision || 0) + 1,
      };
      if (audio) await saveAudioNote(next, audio.id, audio.blob);
      else await saveWorkspace(next);
      current.current = next;
      setLocal(next);
      setStatus("Saved on this device");
    } finally {
      writing.current = false;
    }
  }
  async function connectBook(id, data, restoring = false) {
    if (!restoring) await rememberGoogleWorkbook(id);
    try {
      localStorage.setItem(selectedWorkbookKey, id);
    } catch {
      // A blocked local store must not undo a verified Google connection.
    }
    pending.current = readDraft(`${id}:pending-write`);
    setHasPending(!!pending.current);
    setBookId(id);
    refreshDrafts(id);
    setRemote(data);
    setVerifiedAt(new Date().toISOString());
    if (!restoring) {
      setSelected("");
      setEditing(null);
    }
    if (restoring) {
      try {
        const savedProject = localStorage.getItem(
          `streamlion-last-project:${id}`,
        );
        if (
          !navigation.current.selected &&
          data.Projects.some(
            (project) =>
              project.recordId === savedProject &&
              project.reviewState !== "archived" &&
              !project.deletedAt,
          )
        ) {
          setSelected(savedProject);
          if (
            navigation.current.page === "Projects" &&
            !navigation.current.editing
          )
            setPage("Project home");
        }
      } catch {
        /* selection storage is optional */
      }
    }
    setStatus("Google records refreshed");
    try {
      const copy = await loadSiteCopy(id);
      cacheEnabled.current = !!copy;
      const refreshed = copy ? await saveSiteCopy(id, data) : null;
      cacheLoadEpoch.current++;
      setSiteCopy(refreshed);
    } catch (e) {
      setError(e.message);
    }
  }
  function disconnect(preserveSelection = false) {
    restoreEpoch.current++;
    setRestoreError("");
    if (!preserveSelection) {
      pending.current = null;
      setHasPending(false);
      try {
        localStorage.removeItem(selectedWorkbookKey);
      } catch {
        // The in-memory selection is still cleared below.
      }
      setBookId("");
    }
    refreshDrafts(preserveSelection ? bookId : "");
    setRemote(null);
    setSelected("");
    setEditing(null);
    setStatus(
      preserveSelection
        ? "Reconnect Google to load your selected workbook"
        : "Device workspace",
    );
  }
  async function refresh() {
    setSyncBusy(true);
    setError("");
    try {
      const data = await readWorkbook(bookId);
      await acceptRemote(data);
      setStatus("Google records refreshed " + new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncBusy(false);
    }
  }
  async function showProjectsFromGoogle() {
    setSyncBusy(true);
    setError("");
    try {
      const data = await readWorkbook(bookId);
      await acceptRemote(data);
      setStatus("Google records refreshed " + new Date().toLocaleTimeString());
      setEditing(null);
      setPage("Projects");
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncBusy(false);
    }
  }
  async function cloudSave(tab, fields, recordId, reviewState, draftKey) {
    if (!hasGoogleSession())
      throw new Error("Reconnect Google in Connections before saving.");
    const previous = remote[tab].find((r) => r.recordId === recordId);
    const signature = JSON.stringify({
      bookId,
      tab,
      fields,
      recordId,
      reviewState,
    });
    if (pending.current && pending.current.signature !== signature)
      throw new Error(
        "A previous Google write has an uncertain outcome. Use Retry pending save above before starting a different save.",
      );
    const revision =
      pending.current?.revision ||
      makeRevision(fields, previous, recordId, reviewState);
    const operation = pending.current || {
      signature,
      revision,
      tab,
      expected: previous ?? null,
      draftKey,
    };
    writeDraft(`${bookId}:pending-write`, operation);
    pending.current = operation;
    setHasPending(true);
    setSyncBusy(true);
    try {
      const after = await appendRevision(
        bookId,
        tab,
        revision,
        operation.expected,
      );
      await acceptRemote(after);
      clearDraft(`${bookId}:pending-write`);
      pending.current = null;
      setHasPending(false);
      setStatus("Saved and verified in Google");
      return revision.recordId;
    } finally {
      setSyncBusy(false);
    }
  }
  async function retryPending() {
    const op = pending.current;
    if (!op) return;
    setSyncBusy(true);
    setError("");
    try {
      const after = await appendRevision(
        bookId,
        op.tab,
        op.revision,
        op.expected,
      );
      await acceptRemote(after);
      clearDraft(`${bookId}:pending-write`);
      pending.current = null;
      setHasPending(false);
      clearSavedDraft(bookId, op);
      refreshDrafts();
      if (op.tab === "Projects" && op.revision.reviewState === "archived") {
        setSelected("");
        setEditing(null);
        setPage("Projects");
      } else if (op.tab === "Projects") {
        if (
          current.current.jobs.some((job) => job.id === op.revision.recordId)
        ) {
          await commit((w) => ({
            ...w,
            jobs: w.jobs.filter((job) => job.id !== op.revision.recordId),
            notes: w.notes.map((note) =>
              note.jobId === op.revision.recordId && !note.pendingBookId
                ? { ...note, pendingBookId: bookId }
                : note,
            ),
          }));
        }
        setSelected(op.revision.recordId);
        setEditing(null);
        setPage("Project home");
      } else {
        if (
          current.current.notes.some(
            (note) =>
              note.id === op.revision.recordId && note.pendingBookId === bookId,
          )
        ) {
          await acknowledgeFieldRecord(op.revision.recordId);
        }
        setNoteEpoch((x) => x + 1);
      }
      setStatus("Pending save verified in Google");
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncBusy(false);
    }
  }
  async function saveProject(
    fields,
    project,
    reviewed,
    draftId,
    draftScope,
    step,
  ) {
    let id = project?.id || crypto.randomUUID();
    const draftKey = projectDraftKey(
      project ? bookId || "local" : draftScope || bookId || "local",
      project?.id || draftId || "new",
    );
    assertSaveDestination(bookId, remote);
    if (remote) {
      if (pending.current?.revision && !project)
        id = pending.current.revision.recordId;
      id = await cloudSave(
        "Projects",
        fields,
        id,
        reviewed ? "reviewed" : "draft",
        draftKey,
      );
      if (project?.deviceOnly) {
        await commit((w) => ({
          ...w,
          jobs: w.jobs.filter((job) => job.id !== id),
          notes: w.notes.map((note) =>
            note.jobId === id && !note.pendingBookId
              ? { ...note, pendingBookId: bookId }
              : note,
          ),
        }));
      }
    } else
      await commit((w) => ({
        ...w,
        jobs: project
          ? w.jobs.map((j) =>
              j.id === id
                ? {
                    ...j,
                    ...fields,
                    reviewState: reviewed ? "reviewed" : "draft",
                    offeredCents: fields.offeredFee
                      ? Math.round(+fields.offeredFee * 100)
                      : null,
                  }
                : j,
            )
          : [
              ...w.jobs,
              {
                ...fields,
                id,
                createdAt: new Date().toISOString(),
                reviewState: reviewed ? "reviewed" : "draft",
                status: "Draft",
                offeredCents: fields.offeredFee
                  ? Math.round(+fields.offeredFee * 100)
                  : null,
              },
            ],
      }));
    clearDraft(draftKey);
    refreshDrafts();
    setSelected(id);
    if (reviewed) {
      setEditing(null);
      setPage("Project home");
    } else {
      setEditing((previous) =>
        previous
          ? {
              ...previous,
              ...fields,
              id,
              draftId: id,
              draftScope: remote ? bookId : "local",
              reviewState: "draft",
              savedStep: step,
              savedNotice: remote
                ? "Draft saved in Google. Keep editing, or return to Projects when ready."
                : "Draft saved on this device. Keep editing, or return to Projects when ready.",
            }
          : previous,
      );
    }
    return id;
  }
  async function deleteProject(project) {
    if (
      !window.confirm(
        `Move “${project.title}” to Deleted projects? You can restore it later. Its field notes and Google history will be kept.`,
      )
    )
      return;
    setError("");
    if (!project.deviceOnly) {
      assertSaveDestination(bookId, remote);
      await cloudSave(
        "Projects",
        legacyFields(project),
        project.id,
        "archived",
      );
    } else {
      await commit((w) => ({
        ...w,
        jobs: w.jobs.map((job) =>
          job.id === project.id
            ? { ...job, deletedAt: new Date().toISOString() }
            : job,
        ),
      }));
    }
    if (selected === project.id) setSelected("");
    setStatus("Project moved to Deleted projects");
  }
  async function restoreProject(project) {
    setError("");
    if (!project.deviceOnly) {
      assertSaveDestination(bookId, remote);
      await cloudSave("Projects", legacyFields(project), project.id, "draft");
    } else {
      await commit((w) => ({
        ...w,
        jobs: w.jobs.map((job) => {
          if (job.id !== project.id) return job;
          const { deletedAt, ...restored } = job;
          return restored;
        }),
      }));
    }
    setStatus("Project restored. Review its details before using it.");
  }
  async function addNote(context, blob) {
    const owner = workspace.jobs.find(
      (project) => project.id === context.jobId,
    );
    if (!owner)
      throw new Error(
        "Choose an available project before adding field records.",
      );
    const destination = owner.deviceOnly ? "" : bookId;
    const note = newFieldRecord(context, destination, blob);
    await commit(
      (w) => ({ ...w, notes: [...w.notes, note] }),
      blob ? { id: note.id, blob } : null,
    );
    setStatus(
      destination
        ? "Field record kept on this device · waiting to send to Google"
        : "Field record saved on this device",
    );
    if (destination && remote && hasGoogleSession() && !pending.current) {
      setOutboxBusy(true);
      try {
        await sendQueuedRecord(note);
        setStatus("Field record saved and verified in Google");
      } catch (e) {
        setError(
          `${e.message} Your field record and original file are kept on this device for retry.`,
        );
      } finally {
        setOutboxBusy(false);
      }
    }
  }
  async function acknowledgeFieldRecord(id) {
    await commit((w) => ({
      ...w,
      notes: w.notes.filter(
        (note) => !(note.id === id && note.pendingBookId === bookId),
      ),
    }));
  }
  async function sendQueuedRecord(record) {
    await sendFieldRecord(record, {
      getBlob: getAudio,
      reserveId: reserveFieldFileId,
      retainFile: retainFieldFile,
      persist: (note) =>
        commit((w) => ({
          ...w,
          notes: w.notes.map((item) => (item.id === note.id ? note : item)),
        })),
      save: (fields, id, reviewState) =>
        cloudSave("Observations", fields, id, reviewState),
      acknowledge: acknowledgeFieldRecord,
    });
  }
  async function syncFieldRecords() {
    setOutboxBusy(true);
    setError("");
    try {
      if (!remote || !hasGoogleSession())
        throw new Error(
          "Reconnect Google before sending waiting field records.",
        );
      if (pending.current)
        throw new Error(
          "Verify the pending Google save first, then send the waiting field records.",
        );
      const queue = current.current.notes.filter(
        (note) => note.pendingBookId === bookId,
      );
      for (const record of queue) {
        if (
          !remote.Projects.some(
            (project) =>
              project.recordId === record.jobId &&
              project.reviewState !== "archived",
          )
        )
          throw new Error(
            "A queued record belongs to a project that is no longer active in this workbook. Keep its backup and restore the project before sending.",
          );
        await sendQueuedRecord(record);
      }
      setStatus("Field records saved and verified in Google");
    } catch (e) {
      setError(
        `${e.message} Unsent records and originals remain on this device.`,
      );
    } finally {
      setOutboxBusy(false);
    }
  }
  async function saveWorkflow(plan, expectedText) {
    const owner = workspace.jobs.find((project) => project.id === selected);
    if (!owner) throw new Error("Choose a project first.");
    const previous = workflowNote(workspace.notes, owner.id);
    if (previous?.pendingBookId)
      throw new Error(
        "Send the waiting field records first so this checklist has a verified Google destination.",
      );
    if ((previous?.text || "") !== expectedText)
      throw new Error(
        "This checklist changed. Reload and review before saving.",
      );
    const text = JSON.stringify(validateWorkflow(plan));
    const id = previous?.id || crypto.randomUUID();
    if (!owner.deviceOnly) {
      assertSaveDestination(bookId, remote);
      await cloudSave(
        "Observations",
        validateNote({
          projectId: owner.id,
          area: WORKFLOW_AREA,
          text,
          sourceText: previous?.sourceText || previous?.text || text,
          audioUrl: "",
        }),
        id,
        "reviewed",
      );
    } else
      await commit((w) => ({
        ...w,
        notes: previous
          ? w.notes.map((note) =>
              note.id === id
                ? {
                    ...reviseNote(note, text, new Date().toISOString()),
                    reviewed: true,
                  }
                : note,
            )
          : [
              ...w.notes,
              {
                id,
                jobId: owner.id,
                area: WORKFLOW_AREA,
                text,
                sourceText: text,
                createdAt: new Date().toISOString(),
                reviewed: true,
                revisions: [],
              },
            ],
      }));
  }
  function startRepeat(project) {
    const id = `draft-${crypto.randomUUID()}`,
      scope = bookId || "local";
    const blank = Object.fromEntries(
      PROJECT_FIELDS.map((field) => [field.key, ""]),
    );
    try {
      const plan = readWorkflow(workspace.notes, project);
      writeDraft(projectDraftKey(scope, id), {
        fields: {
          ...blank,
          ...reusableFields(project),
          ...(plan.requirements.length
            ? {
                deliverables: plan.requirements
                  .map((item) => item.label)
                  .join("\n"),
              }
            : {}),
          ...(plan.siteLessons
            ? {
                notes: `Prior visit lessons (review for this visit): ${plan.siteLessons}`,
              }
            : {}),
          sourceNotes: `Repeat visit based on ${project.title}${project.reference ? ` (${project.reference})` : ""}. Review against the new instructions.`,
        },
        base: JSON.stringify(blank),
      });
      setEditing({ draftId: id, draftScope: scope });
    } catch {
      setError(
        "This device could not create the repeat-visit draft. Download the original project details as a backup.",
      );
    }
  }
  async function updateNote(id, text, review, expectedText) {
    if (pending.current?.revision.recordId === id)
      throw new Error(
        "Verify this pending Google save before changing its field record. Your current wording is kept.",
      );
    const n = workspace.notes.find((n) => n.id === id);
    if (!n || (expectedText !== undefined && n.text !== expectedText))
      throw new Error(
        "This record changed. Reopen and review the latest version before correcting it.",
      );
    if (!local.notes.some((note) => note.id === id)) {
      assertSaveDestination(bookId, remote);
      await cloudSave(
        "Observations",
        validateNote({
          projectId: n.jobId,
          area: n.area,
          text: text ?? n.text,
          sourceText: n.sourceText || n.text,
          audioUrl: n.audioUrl || "",
        }),
        id,
        review ? "reviewed" : "draft",
      );
    } else
      await commit((w) => ({
        ...w,
        notes: w.notes.map((n) =>
          n.id === id
            ? {
                ...(text !== null
                  ? reviseNote(n, text, new Date().toISOString())
                  : n),
                reviewed: !!review,
              }
            : n,
        ),
      }));
  }
  const disabled = captureBusy || syncBusy || outboxBusy;
  const navigate = (p) => {
    refreshDrafts();
    setEditing(null);
    setPage(p);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img
            src="/lion.png"
            width="32"
            height="32"
            alt=""
            aria-hidden="true"
          />
          <span>StreamLion</span>
        </div>
        <nav aria-label="Main">
          {[
            [FileText, "Projects"],
            [NotebookPen, "Field notes"],
            [Ruler, "Measurements"],
            [MessageCircle, "Ask"],
            [Link, "Connections"],
          ].map(([Icon, label]) => (
            <button
              key={label}
              aria-label={label}
              disabled={disabled}
              className={page === label ? "active" : ""}
              onClick={() => navigate(label)}
              title={
                {
                  Projects: "Find, review, or create a project.",
                  "Field notes": "Record what happened at a site.",
                  Measurements:
                    "Dictate or type exact dimensions and organize them by room.",
                  Ask: "Get quick answers from your project or discuss it in your own ChatGPT account.",
                  Connections:
                    "Connect your Google account and choose a workbook.",
                }[label]
              }
            >
              <Icon size={20} />
              {label === "Measurements" ? (
                <>
                  <span className="measure-nav-full">Measurements</span>
                  <span className="measure-nav-short" aria-hidden="true">
                    Measure
                  </span>
                </>
              ) : (
                label
              )}
            </button>
          ))}
        </nav>
        <div className="workspace-status">
          <span>
            {bookId ? "Google workbook" : "Local device"}
            <br />
            <span role="status">{status}</span>
          </span>
        </div>
      </aside>
      <main>
        {newerVersion && (
          <section className="sync-bar" aria-label="App update">
            <span>
              A new version is ready.{" "}
              {editing || page === "Field notes" || page === "Measurements"
                ? "Finish this edit or return to Projects before updating."
                : "Saved drafts will be kept."}
            </span>
            <button
              disabled={
                disabled ||
                !!editing ||
                page === "Field notes" ||
                page === "Measurements"
              }
              onClick={applyUpdate}
            >
              Update StreamLion
            </button>
          </section>
        )}
        {hasPending && (
          <section className="intake-panel">
            <h2>Google save awaiting verification</h2>
            <p>
              Your operation is kept on this device with its original ID.
              Reconnect if needed, then retry to verify it without duplicating
              it.
            </p>
            <div className="actions">
              <button disabled={disabled} onClick={retryPending}>
                Retry pending save
              </button>
              <button
                onClick={() =>
                  download(
                    new Blob([JSON.stringify(pending.current, null, 2)], {
                      type: "application/json",
                    }),
                    "streamlion-pending-save.json",
                  )
                }
              >
                Download pending operation
              </button>
              <button
                disabled={disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "Check the workbook first: this operation may already be saved. Release its retry record while retaining your editable draft?",
                    )
                  ) {
                    clearDraft(`${bookId}:pending-write`);
                    pending.current = null;
                    setHasPending(false);
                  }
                }}
              >
                I checked Google — release retry
              </button>
            </div>
          </section>
        )}

        {bookId && (
          <div className="sync-bar">
            <span>
              Google-owned records ·{" "}
              {remote && hasGoogleSession()
                ? "connected"
                : siteCopy
                  ? `site copy checked ${new Date(siteCopy.verifiedAt).toLocaleString()}`
                  : "reconnect needed"}
            </span>
            <button
              disabled={disabled || !!editing || !hasGoogleSession()}
              onClick={async () => {
                await refresh(); /* Keep unresolved writes until the same operation is retried. */
              }}
            >
              Refresh from Google
            </button>
          </div>
        )}
        {waitingNotes.length > 0 && (
          <section className="outbox-bar" aria-label="Waiting field records">
            <span>
              {waitingNotes.length} field record
              {waitingNotes.length === 1 ? "" : "s"} safely on this device ·
              waiting for Google
            </span>
            <button
              disabled={
                disabled || !remote || !hasGoogleSession() || hasPending
              }
              onClick={syncFieldRecords}
            >
              {outboxBusy ? "Sending…" : "Send waiting records to Google"}
            </button>
            {(!remote || !hasGoogleSession()) && (
              <button
                disabled={disabled}
                onClick={() => navigate("Connections")}
              >
                Reconnect Google
              </button>
            )}
          </section>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!ready ? (
          <p>Opening local workspace…</p>
        ) : editing ? (
          <ProjectEditor
            key={`${editing.draftScope || bookId || "local"}:${editing.draftId || editing.id || "new"}`}
            project={editing.id ? editing : null}
            draftId={editing.draftId}
            draftScope={editing.draftScope || bookId || "local"}
            savedStep={editing.savedStep}
            savedNotice={editing.savedNotice}
            bookId={bookId}
            googleReady={!!remote && hasGoogleSession()}
            onSave={saveProject}
            onCancel={() => {
              refreshDrafts();
              setEditing(null);
              setPage("Projects");
            }}
            onConnectGoogle={() => {
              refreshDrafts();
              setEditing(null);
              setPage("Connections");
            }}
            onRefreshProjects={showProjectsFromGoogle}
            templates={templates}
          />
        ) : page === "Projects" ? (
          <Jobs
            workspace={workspace}
            bookId={bookId}
            googleConnected={!!remote && hasGoogleSession()}
            onAsk={() => setPage("Ask")}
            archivedProjects={archivedProjects}
            archivedDrafts={visibleDrafts(bookId, true)}
            drafts={drafts}
            onCreate={() =>
              setEditing({
                draftId: `draft-${crypto.randomUUID()}`,
                draftScope: bookId || "local",
              })
            }
            onResumeDraft={(draft) =>
              setEditing({ draftId: draft.draftId, draftScope: draft.scope })
            }
            onDeleteDraft={(draft) => {
              if (
                window.confirm(
                  `Move the unfinished project “${draft.fields.title}” to Deleted projects? You can restore it later.`,
                )
              ) {
                try {
                  const key = projectDraftKey(draft.scope, draft.draftId);
                  writeDraft(key, {
                    ...readDraft(key),
                    deletedAt: new Date().toISOString(),
                  });
                  refreshDrafts();
                } catch {
                  setError(
                    "This device could not move the draft. Your project remains in the list.",
                  );
                }
              }
            }}
            onRestoreDraft={(draft) => {
              try {
                const key = projectDraftKey(draft.scope, draft.draftId);
                const saved = readDraft(key);
                if (!saved) return;
                const { deletedAt, ...restored } = saved;
                writeDraft(key, restored);
                refreshDrafts();
              } catch {
                setError(
                  "This device could not restore the draft. Please retry.",
                );
              }
            }}
            onEdit={(project) => setEditing(project)}
            onDeleteProject={(project) =>
              deleteProject(project).catch((e) => setError(e.message))
            }
            onRestoreProject={(project) =>
              restoreProject(project).catch((e) => setError(e.message))
            }
            onOpen={(id) => {
              setSelected(id);
              setPage("Project home");
            }}
          />
        ) : page === "Project home" && active ? (
          <ProjectHome
            key={`${bookId || "local"}:${active.id}`}
            project={active}
            notes={workspace.notes}
            scope={active.deviceOnly ? "local" : bookId}
            connected={!!remote && hasGoogleSession()}
            siteCopy={siteCopy}
            onSiteCopy={keepSiteCopy}
            onBack={() => setPage("Projects")}
            onEdit={() => setEditing(active)}
            onAsk={() => setPage("Ask")}
            onMeasurements={() => setPage("Measurements")}
            onNotes={(area) => {
              setAreaHint({
                projectId: active.id,
                scope: active.deviceOnly ? "local" : bookId,
                area,
              });
              setPage("Field notes");
            }}
            onSave={saveWorkflow}
            onRepeat={() => startRepeat(active)}
          />
        ) : page === "Measurements" ? (
          <>
            <label>
              Project to measure
              <select
                value={selected}
                disabled={disabled}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose a project</option>
                {workspace.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </select>
            </label>
            {active ? (
              <Measurements
                key={`${noteControls.draftScope}:${selected}`}
                project={active}
                notes={workspace.notes}
                scope={noteControls.draftScope}
                disabled={disabled}
                onSave={(context, id, base) =>
                  id
                    ? updateNote(id, context.text, context.reviewed, base)
                    : addNote(context)
                }
              />
            ) : (
              <section className="empty">
                <h1>Measure a project</h1>
                <p>
                  Choose a saved project above. Its rooms and measurements stay
                  attached to that job.
                </p>
              </section>
            )}
          </>
        ) : page === "Field notes" ? (
          <>
            {active && (
              <div className="actions project-toolbar">
                <button disabled={disabled} onClick={() => setEditing(active)}>
                  Edit project details
                </button>
                <button
                  disabled={disabled}
                  onClick={() => setPage("Project home")}
                >
                  Project home
                </button>
                <button
                  disabled={disabled}
                  onClick={() => setPage("Measurements")}
                >
                  Measurements
                </button>
                <button disabled={disabled} onClick={() => setPage("Ask")}>
                  Ask about this project
                </button>
              </div>
            )}
            <Notes
              key={`${noteControls.draftScope}:${selected}:${noteEpoch}`}
              workspace={workspace}
              selected={selected}
              onSelect={(id) => {
                setAreaHint(null);
                setSelected(id);
              }}
              onAdd={addNote}
              onAudio={addNote}
              onPhoto={addNote}
              initialArea={areaHint}
              onRevise={(id, text) => updateNote(id, text, false)}
              onReview={(id) => updateNote(id, null, true)}
              captureBusy={disabled}
              onCaptureBusy={setCaptureBusy}
              draftScope={noteControls.draftScope}
              allowAudio={noteControls.allowAudio}
            />
          </>
        ) : page === "Ask" ? (
          <>
            <header className="page-head">
              <div>
                <h1 title="Open a conversation about a project or a site note.">
                  Ask StreamLion
                </h1>
                <p>
                  Quick answers here. Your own ChatGPT for a deeper discussion.
                </p>
              </div>
            </header>
            <label>
              Project to discuss
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                title="Choose a project, or leave All projects selected to ask a general question."
              >
                <option value="">Choose a project</option>
                {workspace.jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
            <ChatGPTPanel
              key={selected}
              project={active}
              notes={workspace.notes}
              asOf={
                !active?.deviceOnly
                  ? remote
                    ? verifiedAt
                    : siteCopy?.verifiedAt
                  : new Date().toISOString()
              }
            />
          </>
        ) : (
          <Connections
            bookId={bookId}
            onRestore={restoreConnection}
            restoreError={restoreError}
            onWorkbook={connectBook}
            onDisconnect={disconnect}
            busyCapture={disabled}
            siteCopy={siteCopy}
            onSiteCopy={keepSiteCopy}
            onBackupBusy={setSyncBusy}
            onBackupRestored={async () => {
              const restored = await loadWorkspace();
              current.current = restored;
              setLocal(restored);
              const destination = bookId || rememberedWorkbook();
              if (!bookId) setBookId(destination);
              refreshDrafts(destination);
              const copy = await loadSiteCopy(destination);
              cacheLoadEpoch.current++;
              setSiteCopy(copy);
              cacheEnabled.current = !!copy;
              pending.current = destination
                ? readDraft(`${destination}:pending-write`)
                : null;
              setHasPending(!!pending.current);
              setStatus("Device backup restored");
            }}
          />
        )}
      </main>
    </div>
  );
}
