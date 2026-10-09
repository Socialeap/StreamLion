import { PROJECT_FIELDS, validateFields } from "./project-schema.js";
import { CLIENT_FIELDS, REQUIRED_FIELDS } from "./client-permissions.js";
import { CoordinationError, stableJSON } from "./coordination-contract.js";
import { TM_ESTIMATE } from "./capture-estimate.js";

export const INTAKE_KIND = "streamlion.intake-template";
export const INTAKE_DEFAULT_FIELDS = [
  "scope",
  "exclusions",
  "accessInstructions",
  "deliverables",
  "deliveryDeadline",
  "deliveryDestination",
  "notes",
  "offeredFee",
  "currency",
  "paymentTerms",
];
const fieldTypes = new Map(PROJECT_FIELDS.map((f) => [f.key, f.type]));
const object = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new CoordinationError("Unsupported service template information.");
};
const text = (value, limit, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    (required && !value.trim())
  )
    throw new CoordinationError("Provide concise service template wording.");
  return value.trim();
};
export const isIntakeTemplate = (record) => record?.kind === INTAKE_KIND;
export function questionApplies(question, fields) {
  if (!question.when) return true;
  const { field, op, value } = question.when,
    answer = fields[field] || "";
  if (op === "not_empty") return Boolean(answer.trim());
  if (op === "greater_than")
    return answer.trim() !== "" && Number(answer) > Number(value);
  return answer.trim().toLowerCase() === value.toLowerCase();
}
export const activeIntakeQuestions = (job, fields = job.fields) =>
  (job.intake?.questions || []).filter((q) => questionApplies(q, fields));
export function validateIntakeAnswers(job, fields) {
  for (const q of activeIntakeQuestions(job, fields))
    if (
      q.options?.length &&
      fields[q.field]?.trim() &&
      !q.options.includes(fields[q.field].trim())
    )
      throw new CoordinationError(
        `Choose one of the listed answers for ${q.label}.`,
      );
}
export function validateIntakeConfig(input) {
  object(input, [
    "schemaVersion",
    "name",
    "description",
    "defaults",
    "questions",
    "estimateProfile",
  ]);
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1)
    throw new CoordinationError("Unsupported service template version.");
  const defaults = input.defaults ?? {};
  object(defaults, INTAKE_DEFAULT_FIELDS);
  for (const value of Object.values(defaults)) text(value, 6000);
  let checked;
  try {
    checked = validateFields(defaults, { requireTitle: false });
  } catch (error) {
    throw new CoordinationError(error.message);
  }
  if (!Array.isArray(input.questions) || input.questions.length > 12)
    throw new CoordinationError("Use at most 12 service questions.");
  const seen = new Set();
  const questions = input.questions.map((q) => {
    object(q, ["field", "label", "help", "required", "when", "options"]);
    if (
      !CLIENT_FIELDS.has(q.field) ||
      seen.has(q.field) ||
      typeof q.required !== "boolean"
    )
      throw new CoordinationError(
        "Each service question needs a unique client-editable field.",
      );
    seen.add(q.field);
    const question = {
      field: q.field,
      label: text(q.label, 120, true),
      help: text(q.help ?? "", 500),
      required: REQUIRED_FIELDS.includes(q.field) || q.required,
    };
    if (q.options?.length) {
      if (
        !["text", "textarea"].includes(fieldTypes.get(q.field)) ||
        !Array.isArray(q.options) ||
        q.options.length > 12
      )
        throw new CoordinationError(
          "Use at most 12 choices on a text question.",
        );
      question.options = q.options.map((value) => text(value, 120, true));
      if (new Set(question.options).size !== question.options.length)
        throw new CoordinationError("Question choices must be distinct.");
    } else if (q.options !== undefined && !Array.isArray(q.options))
      throw new CoordinationError("Question choices must be a list.");
    if (q.when !== undefined && q.when !== null) {
      object(q.when, ["field", "op", "value"]);
      if (
        !CLIENT_FIELDS.has(q.when.field) ||
        q.when.field === q.field ||
        REQUIRED_FIELDS.includes(q.field) ||
        !["equals", "not_empty", "greater_than"].includes(q.when.op)
      )
        throw new CoordinationError(
          "Use a supported condition; core required fields remain visible.",
        );
      question.when = { field: q.when.field, op: q.when.op };
      if (q.when.op !== "not_empty") {
        question.when.value = text(q.when.value, 1000, true);
        if (
          q.when.op === "greater_than" &&
          (q.when.field !== "propertySizeSqFt" ||
            !/^\d{1,9}(\.\d{1,4})?$/.test(question.when.value))
        )
          throw new CoordinationError(
            "A size condition needs a numeric square-foot threshold.",
          );
      } else if (q.when.value !== undefined && q.when.value !== "")
        throw new CoordinationError(
          "An answered-field condition has no comparison value.",
        );
    }
    return question;
  });
  // Conditional questions cannot hide one another in a dependency cycle.
  const dependencies = new Map(
    questions.filter((q) => q.when).map((q) => [q.field, q.when.field]),
  );
  for (const field of dependencies.keys()) {
    const path = new Set();
    for (
      let next = field;
      dependencies.has(next);
      next = dependencies.get(next)
    ) {
      if (path.has(next))
        throw new CoordinationError(
          "Service question conditions cannot form a cycle.",
        );
      path.add(next);
    }
  }
  const config = {
    schemaVersion: 1,
    name: text(input.name, 120, true),
    description: text(input.description ?? "", 1000),
    defaults: Object.fromEntries(
      Object.keys(defaults).map((k) => [k, checked[k]]),
    ),
    questions,
    ...(input.estimateProfile
      ? { estimateProfile: input.estimateProfile }
      : {}),
  };
  if (
    input.estimateProfile !== undefined &&
    input.estimateProfile !== TM_ESTIMATE
  )
    throw new CoordinationError("Select a supported estimate preset.");
  validateIntakeAnswers({ intake: config }, checked);
  if (stableJSON(config).length > 12000)
    throw new CoordinationError(
      "Service template is too large (maximum 12,000 characters).",
    );
  return config;
}
export function validateIntakeRecord(record) {
  object(record, [
    "kind",
    "version",
    "id",
    "provider",
    "revision",
    "createdAt",
    "updatedAt",
    "config",
  ]);
  if (
    !isIntakeTemplate(record) ||
    record.version !== 1 ||
    !/^intake-[\w-]{1,80}$/.test(record.id) ||
    typeof record.provider !== "string" ||
    !record.provider ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    !Number.isSafeInteger(record.createdAt) ||
    !Number.isSafeInteger(record.updatedAt) ||
    record.createdAt > record.updatedAt
  )
    throw new CoordinationError("Invalid service template history.", 409);
  const config = validateIntakeConfig(record.config);
  if (stableJSON(config) !== stableJSON(record.config))
    throw new CoordinationError(
      "Service template history needs reviewed recovery.",
      409,
    );
  return record;
}
export function reviseIntakeTemplate(
  previous,
  { id, provider, config, expectedVersion },
  now,
) {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion !== (previous ? previous.revision + 1 : 0) ||
    (previous && (previous.provider !== provider || previous.id !== id))
  )
    throw new CoordinationError(
      "This service template changed. Reload before saving a new version.",
      409,
    );
  const record = {
    kind: INTAKE_KIND,
    version: 1,
    id,
    provider,
    revision: previous ? previous.revision + 1 : 0,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    config: validateIntakeConfig(config),
  };
  return validateIntakeRecord(record);
}
export function pinIntakeTemplate(record) {
  validateIntakeRecord(record);
  return {
    schemaVersion: 1,
    id: record.id,
    version: record.revision + 1,
    name: record.config.name,
    description: record.config.description,
    questions: structuredClone(record.config.questions),
    ...(record.config.estimateProfile
      ? { estimateProfile: record.config.estimateProfile }
      : {}),
  };
}
export function selectedIntakeTemplate(snapshot, selection, provider) {
  object(selection, ["id", "version"]);
  if (
    typeof selection.id !== "string" ||
    !Number.isSafeInteger(selection.version) ||
    selection.version < 1
  )
    throw new CoordinationError("Select a saved service template version.");
  const record = [...snapshot.events.values()].find(
    (event) =>
      event.jobId === selection.id &&
      event.revision === selection.version - 1 &&
      isIntakeTemplate(event.job),
  )?.job;
  if (!record || record.provider !== provider)
    throw new CoordinationError(
      "This service template version is unavailable.",
      409,
    );
  return validateIntakeRecord(record);
}

export const INTAKE_PRESETS = [
  {
    name: "3D capture",
    description:
      "Define the rooms, access and final hosting or handoff before confirming the visit.",
    defaults: {
      deliverables: "3D tour; confirm any additional outputs in the brief.",
    },
    questions: [
      {
        field: "scope",
        label: "Which areas need a 3D capture?",
        help: "List rooms, floors, outdoor areas and any special purpose for the capture.",
        required: true,
      },
      {
        field: "propertySizeSqFt",
        label: "Approximate area to capture (sq ft)",
        help: "Leave blank if unknown and ask the provider for help confirming the size.",
        required: true,
      },
      {
        field: "deliveryDestination",
        label: "Hosting and account handoff",
        help: "Who should receive or own the tour? Describe hosting and transfer expectations.",
        required: true,
      },
      {
        field: "document1Url",
        label: "Large-site floor plan or reference link",
        help: "Use an HTTPS reference link, or ask the provider to agree another way to supply it.",
        required: false,
        when: { field: "propertySizeSqFt", op: "greater_than", value: "10000" },
      },
    ],
  },
  {
    name: "Floor plan",
    description:
      "Confirm coverage, required outputs and the intended use of the plan.",
    defaults: {
      deliverables:
        "Floor plan; confirm dimensions, format and intended use with the provider.",
    },
    questions: [
      {
        field: "scope",
        label: "Which floors and areas need a plan?",
        help: "Describe the intended use and any measurements or spaces that need special attention.",
        required: true,
      },
      {
        field: "propertySizeSqFt",
        label: "Approximate plan area (sq ft)",
        help: "Leave blank if the area still needs to be confirmed.",
        required: true,
      },
      {
        field: "deliveryDestination",
        label: "Plan format and delivery instructions",
        help: "State the file format and who should receive it.",
        required: true,
      },
    ],
  },
  {
    name: "Property photography",
    description:
      "Agree the shot coverage, exclusions, delivery and access arrangements.",
    defaults: {
      deliverables:
        "Property photographs; agree the final selection and delivery format.",
    },
    questions: [
      {
        field: "scope",
        label: "Which spaces and shots are needed?",
        help: "Describe the purpose, priority rooms and required views.",
        required: true,
      },
      {
        field: "exclusions",
        label: "Photography exclusions",
        help: "List people, belongings or areas that must stay out of the photographs.",
        required: false,
      },
      {
        field: "deliveryDeadline",
        label: "When are the photographs needed?",
        help: "Include a timezone if the exact delivery time matters.",
        required: true,
      },
    ],
  },
];
export const TM_CAPTURE_PRESET = {
  schemaVersion: 1,
  name: "Transcendence Media · spatial capture",
  description:
    "Request a preliminary 3D capture estimate and availability. Final scope, hosting, handoff, scheduling and invoice require provider review.",
  estimateProfile: TM_ESTIMATE,
  defaults: {
    deliverables:
      "3D capture; agree final outputs, hosting and account handoff with the provider.",
    paymentTerms:
      "No payment due with the request. Provider confirms the final quote and payment terms before agreement.",
  },
  questions: [
    {
      field: "deliveryDestination",
      label: "Matterport / hosting account and handoff instructions",
      help: "State the receiving account or ask for help. Do not enter account passwords. Agree any temporary hosting and transfer deadline with the provider.",
      required: false,
    },
  ],
};
