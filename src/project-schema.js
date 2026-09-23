// One contract shared by the editor, ChatGPT, and the Google workbook.
export const SCHEMA_VERSION = 1;
const field = (key, label, group, type = "text", legacy = "") => ({
  key,
  label,
  group,
  type,
  legacy,
});
export const PROJECT_FIELDS = [
  field("title", "Project name", "Project", "text", "3dScanCapture"),
  field("reference", "Project ID", "Project", "text", "projectId"),
  field(
    "companyName",
    "Commissioning company",
    "Project",
    "text",
    "companyName",
  ),
  field(
    "propertySizeSqFt",
    "Property size (sq ft)",
    "Project",
    "number",
    "propertySize",
  ),
  field(
    "approxHours",
    "Estimated total hours",
    "Project",
    "number",
    "approxHours",
  ),
  field(
    "siteHours",
    "Estimated on-site hours",
    "Project",
    "number",
    "anticipatedWork",
  ),
  field(
    "address",
    "Street address",
    "Location",
    "text",
    "projectAddress[addr_line1]",
  ),
  field(
    "address2",
    "Unit / address line 2",
    "Location",
    "text",
    "projectAddress[addr_line2]",
  ),
  field("city", "City", "Location", "text", "projectAddress[city]"),
  field(
    "region",
    "State / region",
    "Location",
    "text",
    "projectAddress[state]",
  ),
  field("postal", "Postal code", "Location", "text", "projectAddress[postal]"),
  field("country", "Country", "Location"),
  field(
    "requesterName",
    "Requested by",
    "Contacts",
    "text",
    "requestBy[first] + requestBy[last]",
  ),
  field("requesterEmail", "Requester email", "Contacts", "email"),
  field(
    "contact1Name",
    "On-site contact 1",
    "Contacts",
    "text",
    "projectContact",
  ),
  field(
    "contact1Phone",
    "Contact 1 phone",
    "Contacts",
    "tel",
    "projectContact247",
  ),
  field(
    "contact2Name",
    "On-site contact 2",
    "Contacts",
    "text",
    "projectContact254",
  ),
  field(
    "contact2Phone",
    "Contact 2 phone",
    "Contacts",
    "tel",
    "projectContact255",
  ),
  field("providerName", "Capture provider", "Contacts"),
  field("providerEmail", "Provider email", "Contacts", "email"),
  field(
    "startLocal",
    "Start date and time",
    "Schedule",
    "datetime-local",
    "startDate[*]",
  ),
  field(
    "endLocal",
    "Confirmed end date and time",
    "Schedule",
    "datetime-local",
    "endDatetime[*]",
  ),
  field("timeZone", "Time zone (e.g. America/New_York)", "Schedule"),
  field("appointmentStatus", "Appointment status", "Schedule", "appointment"),
  field("proposedTimes", "Proposed availability", "Schedule", "textarea"),
  field("scope", "Scope of work", "Scope", "textarea"),
  field("exclusions", "Exclusions", "Scope", "textarea"),
  field("accessInstructions", "Access instructions", "Scope", "textarea"),
  field(
    "deliverables",
    "Required deliverables / checklist",
    "Scope",
    "textarea",
  ),
  field("deliveryDeadline", "Delivery deadline as stated", "Scope"),
  field(
    "deliveryDestination",
    "Delivery destination / instructions",
    "Scope",
    "textarea",
  ),
  field("notes", "Additional notes", "Scope", "textarea", "additionalNotes"),
  field("offeredFee", "Offered fee", "Money", "money", "pay364"),
  field("agreedFee", "Agreed fee", "Money", "money"),
  field("currency", "Currency (ISO code)", "Money"),
  field("invoiceAmount", "Invoiced amount", "Money", "money"),
  field("paidAmount", "Amount received", "Money", "money", "Amount PAID"),
  field("paidDate", "Payment received date", "Money", "date"),
  field("dueDate", "Confirmed payment due date", "Money", "date"),
  field("paymentTerms", "Payment terms and trigger", "Money", "textarea"),
  field(
    "reference1Name",
    "Reference 1 name",
    "Documents",
    "text",
    "reference1nameshort",
  ),
  field(
    "reference1Url",
    "Reference 1 link",
    "Documents",
    "url",
    "documentimageLink-1",
  ),
  field(
    "reference2Name",
    "Reference 2 name",
    "Documents",
    "text",
    "reference2nameshort",
  ),
  field(
    "reference2Url",
    "Reference 2 link",
    "Documents",
    "url",
    "documentimageLink-2",
  ),
  field(
    "document1Name",
    "Document 1 name",
    "Documents",
    "text",
    "document1Name",
  ),
  field(
    "document1Url",
    "Document 1 link",
    "Documents",
    "url",
    "documentLink-1",
  ),
  field(
    "document2Name",
    "Document 2 name",
    "Documents",
    "text",
    "document2Name",
  ),
  field("document2Url", "Document 2 link", "Documents", "url", "document2Link"),
  field("driveFolderUrl", "Project Drive folder", "Documents", "url"),
  field(
    "otherDocuments",
    "Additional files and links",
    "Documents",
    "textarea",
  ),
  field(
    "sourceNotes",
    "Sources: document, page, passage",
    "Review",
    "textarea",
  ),
  field(
    "unresolved",
    "Missing / conflicting information",
    "Review",
    "textarea",
  ),
];
export const GROUPS = [...new Set(PROJECT_FIELDS.map((f) => f.group))];
export const FIELD_KEYS = PROJECT_FIELDS.map((f) => f.key);
export function validateFields(input, { requireTitle = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Project fields must be an object.");
  for (const key of Object.keys(input))
    if (!FIELD_KEYS.includes(key))
      throw new Error(`Unknown project field: ${key}`);
  const result = {};
  for (const f of PROJECT_FIELDS) {
    const raw = input[f.key] ?? "";
    if (
      typeof raw !== "string" &&
      !(typeof raw === "number" && Number.isFinite(raw))
    )
      throw new Error(`${f.label} must be text or a finite number.`);
    const value = String(raw).trim();
    if (value.length > (f.type === "textarea" ? 12000 : 1000))
      throw new Error(`${f.label} is too long.`);
    if (
      value &&
      (f.type === "money" || f.type === "number") &&
      !/^\d{1,9}(\.\d{1,4})?$/.test(value)
    )
      throw new Error(
        `${f.label}: use a positive number without units or currency symbols.`,
      );
    if (value && f.type === "money" && !/^\d{1,9}(\.\d{1,2})?$/.test(value))
      throw new Error(`${f.label}: use at most two decimal places.`);
    if (value && f.type === "url") {
      let u;
      try {
        u = new URL(value);
      } catch {
        throw new Error(`${f.label} is not a valid URL.`);
      }
      if (u.protocol !== "https:")
        throw new Error(`${f.label} must use HTTPS.`);
    }
    if (
      value &&
      f.type === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    )
      throw new Error(`${f.label} is not a valid email.`);
    if (value && ["date", "datetime-local"].includes(f.type)) {
      const pattern =
        f.type === "date"
          ? /^\d{4}-\d{2}-\d{2}$/
          : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
      const date = new Date(value.slice(0, 10) + "T00:00:00Z");
      if (
        !pattern.test(value) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value.slice(0, 10) ||
        (f.type === "datetime-local" &&
          (+value.slice(11, 13) > 23 || +value.slice(14, 16) > 59))
      )
        throw new Error(`${f.label} is not a valid date/time.`);
    }
    result[f.key] = value;
  }
  if (requireTitle && !result.title) throw new Error("Enter a project name.");
  if (result.currency && !/^[A-Z]{3}$/.test(result.currency))
    throw new Error("Use a three-letter uppercase currency code.");
  if (
    PROJECT_FIELDS.some((f) => f.type === "money" && result[f.key]) &&
    !result.currency
  )
    throw new Error("Specify the currency for monetary amounts.");
  if (result.timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: result.timeZone });
    } catch {
      throw new Error("Use a valid IANA time zone.");
    }
  }
  if ((result.startLocal || result.endLocal) && !result.timeZone)
    throw new Error("A scheduled time needs an explicit time zone.");
  if (
    result.endLocal &&
    (!result.startLocal || result.endLocal < result.startLocal)
  )
    throw new Error("Confirmed end must follow the start.");
  if (
    result.appointmentStatus &&
    !["proposed", "confirmed"].includes(result.appointmentStatus)
  )
    throw new Error("Appointment status must be proposed or confirmed.");
  return result;
}
export function parseIntake(text) {
  if (text.length > 150000)
    throw new Error("Intake is too large; limit each import to one project.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Paste the JSON object from StreamLion in ChatGPT.");
  }
  if (
    data?.schemaVersion !== SCHEMA_VERSION ||
    data.kind !== "streamlion.project"
  )
    throw new Error("Expected StreamLion project schemaVersion 1.");
  if (
    Object.keys(data).some(
      (k) => !["schemaVersion", "kind", "fields"].includes(k),
    )
  )
    throw new Error("Intake contains unsupported metadata.");
  return validateFields(data.fields, { requireTitle: false });
}
export const intakeFor = (fields) => ({
  schemaVersion: SCHEMA_VERSION,
  kind: "streamlion.project",
  fields: validateFields(fields, { requireTitle: false }),
});
export function legacyFields(job) {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, job[k] ?? ""]));
  if (job.offeredCents != null && !fields.offeredFee) {
    fields.offeredFee = (job.offeredCents / 100).toFixed(2);
    fields.currency ||= "USD";
  }
  return validateFields(fields);
}
export const moneyCents = (value) =>
  value === "" ? null : Math.round(Number(value) * 100);
export function searchProjects(jobs, query) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return jobs.filter((j) =>
    terms.every((t) =>
      FIELD_KEYS.map((k) => j[k] || "")
        .join(" ")
        .toLocaleLowerCase()
        .includes(t),
    ),
  );
}
