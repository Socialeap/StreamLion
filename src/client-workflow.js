import {
  validateFields,
  ProjectFieldValidationError,
  FIELD_KEYS,
} from "./project-schema.js";

export const COORDINATION_VERSION = 1;
export const PROJECT_CREDITS = 240;
export const STARTER_CREDITS = 600;
export const CREDIT_UNIT = 12500;
export const DAY = 86400000;
import {
  CLIENT_FIELDS,
  MATERIAL_FIELDS,
  OPERATIONAL_FIELDS,
  REQUIRED_FIELDS,
} from "./client-permissions.js";
import { CoordinationError, stableJSON } from "./coordination-contract.js";
import {
  activeIntakeQuestions,
  validateIntakeAnswers,
  pinIntakeTemplate,
} from "./intake-templates.js";
export {
  CLIENT_FIELDS,
  MATERIAL_FIELDS,
  OPERATIONAL_FIELDS,
  REQUIRED_FIELDS,
} from "./client-permissions.js";
export { CoordinationError, stableJSON } from "./coordination-contract.js";
function validateBriefFields(input, options) {
  try {
    return validateFields(input, options);
  } catch (error) {
    if (!(error instanceof ProjectFieldValidationError)) throw error;
    throw Object.assign(new CoordinationError(error.message), {
      code: "invalid_project_fields",
    });
  }
}
export function isMaterialField(job, key) {
  return (
    MATERIAL_FIELDS.has(key) ||
    (!OPERATIONAL_FIELDS.has(key) &&
      (job.intake?.questions || []).some(
        (q) => q.field === key || q.when?.field === key,
      ))
  );
}
export function missingRequiredFields(
  job,
  fields = job.accepted || job.fields,
) {
  const required = new Map(REQUIRED_FIELDS.map((field) => [field, undefined]));
  for (const q of activeIntakeQuestions(job, fields))
    if (q.required) required.set(q.field, q.label);
  return [...required]
    .filter(([field]) => !fields[field]?.trim())
    .map(([field, label]) => ({
      kind: "missing",
      field,
      ...(label ? { label } : {}),
    }));
}
export function validatePatch(patch, role) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new CoordinationError("Provide project fields.");
  const keys = Object.keys(patch);
  if (
    !keys.length ||
    keys.some(
      (k) =>
        k === "requesterEmail" ||
        !FIELD_KEYS.includes(k) ||
        (role === "client" && !CLIENT_FIELDS.has(k)),
    )
  )
    throw new CoordinationError("These fields cannot be changed.", 403);
  if (keys.some((k) => typeof patch[k] !== "string" || patch[k].length > 6000))
    throw new CoordinationError("A field is invalid or too long.");
  return patch;
}
export function newClientJob({
  id,
  provider,
  clientEmail,
  title,
  now,
  intakeTemplate = null,
}) {
  if (intakeTemplate && intakeTemplate.provider !== provider)
    throw new CoordinationError(
      "This service template belongs to another provider.",
      403,
    );
  const intake = intakeTemplate ? pinIntakeTemplate(intakeTemplate) : null;
  if (
    !/^[\w-]{1,100}$/.test(id) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)
  )
    throw new CoordinationError("Provide a valid client email.");
  const fields = validateBriefFields(
    {
      ...(intakeTemplate?.config.defaults || {}),
      title,
      requesterEmail: clientEmail,
    },
    { requireTitle: false },
  );
  return {
    version: 1,
    id,
    provider,
    state: "draft",
    revision: 0,
    fields,
    ...(intake ? { intake } : {}),
    accepted: null,
    proposal: null,
    questions: [],
    updates: [],
    attachments: [],
    providerApproved: false,
    clientApproved: false,
    deliveryAccepted: false,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    archiveAt: null,
  };
}
export function readiness(job) {
  const fields = job.accepted || job.fields;
  return [
    ...missingRequiredFields(job, fields),
    ...job.questions
      .filter((q) => !q.answer)
      .map((q) => ({ kind: "question", id: q.id })),
    ...job.updates
      .filter((u) => !u.acknowledged)
      .map((u) => ({ kind: "acknowledgment", id: u.id })),
    ...(job.proposal ? [{ kind: "proposal" }] : []),
  ];
}
export function reduceClientJob(previous, command, actor, now) {
  if (!["provider", "client", "system"].includes(actor.role))
    throw new CoordinationError("Unauthorized.", 403);
  if (command.expectedRevision !== previous.revision)
    throw new CoordinationError(
      "This job changed. Refresh and review the current version.",
      409,
    );
  const job = structuredClone(previous);
  const provider = actor.role === "provider";
  const onlyProvider = () => {
    if (!provider)
      throw new CoordinationError("Provider action required.", 403);
  };
  if (
    ["closed", "archived", "cancelled"].includes(job.state) &&
    !["reopen", "extend", "archive", "archive_early", "restore"].includes(
      command.action,
    )
  )
    throw new CoordinationError("This job is read-only.", 409);
  if (
    job.state === "activation_pending" &&
    !["activate", "cancel"].includes(command.action)
  )
    throw new CoordinationError(
      "Confirmation is being recovered. Try again shortly.",
      409,
    );
  switch (command.action) {
    case "attach":
      if (job.attachments.length >= 20)
        throw new CoordinationError("Maximum 20 attachments per job.");
      job.attachments.push(command.attachment);
      break;
    case "edit": {
      const patch = validatePatch(command.fields, actor.role);
      const changed = Object.keys(patch).filter(
        (k) => patch[k] !== job.fields[k],
      );
      if (job.accepted && changed.some((k) => isMaterialField(job, k)))
        throw new CoordinationError(
          "Propose a scope revision instead of changing agreed terms.",
          409,
        );
      const fields = validateBriefFields(
        { ...job.fields, ...patch },
        { requireTitle: false },
      );
      validateIntakeAnswers(job, fields);
      job.fields = fields;
      if (!job.accepted) {
        job.providerApproved = false;
        job.clientApproved = false;
      } else {
        job.accepted = {
          ...job.accepted,
          ...Object.fromEntries(Object.keys(patch).map((k) => [k, fields[k]])),
        };
        if (job.proposal) {
          job.proposal.fields = validateBriefFields({
            ...job.proposal.fields,
            ...Object.fromEntries(
              Object.keys(patch).map((k) => [k, fields[k]]),
            ),
          });
          job.proposal.id = command.id;
          job.proposal.at = now;
          job.proposal.providerApproved = false;
          job.proposal.clientApproved = false;
        }
        if (changed.some((k) => OPERATIONAL_FIELDS.has(k)))
          job.updates.push({
            id: command.id,
            fields: changed,
            actor: actor.role,
            at: now,
            acknowledged: provider,
          });
      }
      break;
    }
    case "submit":
      if (
        job.accepted ||
        !["draft", "clarification", "submitted"].includes(job.state)
      )
        throw new CoordinationError("This request is already agreed.", 409);
      job.state = "submitted";
      break;
    case "question":
      onlyProvider();
      if (
        job.questions.length >= 40 ||
        typeof command.text !== "string" ||
        !command.text.trim() ||
        command.text.length > 2000
      )
        throw new CoordinationError("Provide a concise question (maximum 40).");
      job.questions.push({
        id: command.id,
        text: command.text,
        answer: "",
        at: now,
      });
      if (!job.accepted) {
        job.state = "clarification";
        job.providerApproved = false;
        job.clientApproved = false;
      }
      break;
    case "answer": {
      const q = job.questions.find((q) => q.id === command.questionId);
      if (
        !q ||
        typeof command.text !== "string" ||
        !command.text.trim() ||
        command.text.length > 2000
      )
        throw new CoordinationError("Provide an answer to the question.");
      q.answer = command.text;
      q.answeredBy = actor.role;
      q.answeredAt = now;
      if (!job.accepted) {
        job.providerApproved = false;
        job.clientApproved = false;
      }
      break;
    }
    case "approve":
      if (
        job.accepted ||
        !["submitted", "clarification", "awaiting_agreement"].includes(
          job.state,
        )
      )
        throw new CoordinationError(
          "Submit this request before agreement.",
          409,
        );
      if (readiness(job).length)
        throw new CoordinationError(
          "Resolve required information and questions first.",
          409,
        );
      if (provider) job.providerApproved = true;
      else job.clientApproved = true;
      job.state =
        job.providerApproved && job.clientApproved
          ? "activation_pending"
          : "awaiting_agreement";
      break;
    case "activate":
      if (actor.role !== "system" || job.state !== "activation_pending")
        throw new CoordinationError(
          "Confirmation must be verified by the service.",
          403,
        );
      job.accepted = structuredClone(job.fields);
      job.state = "confirmed";
      break;
    case "propose": {
      if (!job.accepted)
        throw new CoordinationError("There is no accepted scope yet.", 409);
      const patch = validatePatch(command.fields, actor.role);
      const proposedFields = validateBriefFields({ ...job.accepted, ...patch });
      validateIntakeAnswers(job, proposedFields);
      job.proposal = {
        id: command.id,
        fields: proposedFields,
        author: actor.role,
        at: now,
        providerApproved: provider,
        clientApproved: !provider,
      };
      break;
    }
    case "accept_proposal":
      if (!job.proposal || job.proposal.id !== command.proposalId)
        throw new CoordinationError(
          "Review the current proposed version.",
          409,
        );
      if (
        missingRequiredFields(job, job.proposal.fields).length ||
        job.questions.some((q) => !q.answer) ||
        job.updates.some((u) => !u.acknowledged)
      )
        throw new CoordinationError(
          "Resolve required information, questions and operational updates before accepting the revision.",
          409,
        );
      if (provider) job.proposal.providerApproved = true;
      else job.proposal.clientApproved = true;
      if (job.proposal.providerApproved && job.proposal.clientApproved) {
        job.fields = job.proposal.fields;
        job.accepted = structuredClone(job.fields);
        job.proposal = null;
        job.deliveryAccepted = false;
        if (job.state === "delivered") job.state = "in_progress";
      }
      break;
    case "reject_proposal":
      job.proposal = null;
      break;
    case "acknowledge":
      onlyProvider();
      for (const u of job.updates)
        if (u.id === command.updateId) u.acknowledged = true;
      break;
    case "progress":
      onlyProvider();
      if (
        !["confirmed", "in_progress"].includes(job.state) ||
        !["in_progress", "delivered"].includes(command.state)
      )
        throw new CoordinationError(
          "Confirm this job before recording work.",
          409,
        );
      job.state = command.state;
      break;
    case "accept_delivery":
      if (actor.role !== "client" || job.state !== "delivered")
        throw new CoordinationError(
          "Client delivery acknowledgment required.",
          409,
        );
      job.deliveryAccepted = true;
      break;
    case "close":
      onlyProvider();
      if (
        job.state !== "delivered" ||
        readiness(job).length ||
        (!job.deliveryAccepted &&
          !(typeof command.reason === "string" && command.reason.trim()))
      )
        throw new CoordinationError(
          "Resolve follow-up and acknowledge delivery or record a closure reason.",
          409,
        );
      job.state = "closed";
      job.closedAt = now;
      job.archiveAt = now + 90 * DAY;
      job.closureReason = command.reason || "";
      break;
    case "cancel":
      onlyProvider();
      if (!command.reason?.trim())
        throw new CoordinationError("Record a cancellation reason.");
      job.state = "cancelled";
      job.closedAt = now;
      job.archiveAt = now + 90 * DAY;
      job.closureReason = command.reason;
      break;
    case "extend":
      onlyProvider();
      if (
        job.state === "archived" ||
        !job.closedAt ||
        !Number.isSafeInteger(command.until) ||
        command.until <= now ||
        command.until > now + 90 * DAY
      )
        throw new CoordinationError(
          "Extend closed-job access by up to 90 days.",
        );
      job.archiveAt = command.until;
      break;
    case "reopen":
      onlyProvider();
      if (
        !job.closedAt ||
        typeof command.reason !== "string" ||
        !command.reason.trim() ||
        command.reason.length > 2000
      )
        throw new CoordinationError("Record the correction reason.");
      job.state = job.accepted ? "in_progress" : "draft";
      job.closedAt = null;
      job.archiveAt = null;
      job.deliveryAccepted = false;
      job.reopenReason = command.reason.trim();
      job.reopenedAt = now;
      break;
    case "archive":
      if (actor.role !== "system" || !job.closedAt || job.archiveAt > now)
        throw new CoordinationError("Archive deadline has not elapsed.", 409);
      job.state = "archived";
      break;
    case "archive_early":
      onlyProvider();
      if (
        !job.closedAt ||
        !["closed", "cancelled"].includes(job.state) ||
        typeof command.reason !== "string" ||
        !command.reason.trim() ||
        command.reason.length > 2000
      )
        throw new CoordinationError(
          "Archive a closed job only after recording why client access is ending now.",
          409,
        );
      job.archiveAt = now;
      job.state = "archived";
      job.archivalReason = command.reason.trim();
      break;
    case "restore":
      onlyProvider();
      if (job.state !== "archived")
        throw new CoordinationError("This job is not archived.", 409);
      job.state = "closed";
      break;
    default:
      throw new CoordinationError("Unknown job action.");
  }
  job.revision++;
  job.updatedAt = now;
  if (stableJSON(job).length > 40000)
    throw new CoordinationError(
      "This job's active record is full. Preserve its history before proceeding.",
      413,
    );
  return job;
}
export function clientView(job) {
  const view = structuredClone(job);
  delete view.provider;
  for (const fields of [view.fields, view.accepted, view.proposal?.fields])
    if (fields)
      for (const key of [
        "sourceNotes",
        "unresolved",
        "driveFolderUrl",
        "approxHours",
        "siteHours",
      ])
        delete fields[key];
  view.attachments = view.attachments
    .filter((a) => a.visibility === "client")
    .map(({ driveId, ...a }) => a);
  return view;
}
