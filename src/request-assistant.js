// The client request assistant: a chat flow (chat-flow.js) built from the
// provider's shared form — its service template questions, published pricing
// and email rules. Every answer maps onto a client-editable project field, a
// priced extra or the proposed budget. Facts without a field of their own
// (space type, floors, ceilings, dimension rooms, role) become labelled lines
// in the notes, so the workbook keeps its existing columns.
import { createFlow } from "./chat-flow.js";
import { CLIENT_FIELDS } from "./client-permissions.js";
import { PROJECT_FIELDS } from "./project-schema.js";
import { questionApplies } from "./intake-templates.js";
import {
  budgetAllowed,
  calculatePricing,
  decimalUnits,
  pricingKey,
} from "./provider-pricing.js";
import { brandingPhone, formatPhone } from "./provider-branding.js";
import { estimateMoney } from "./capture-estimate.js";

export const REQUEST_PREFIX = "streamlion-request-v1:";
const DAY = 86400000;
export const REQUEST_KEEP_DAYS = 7;

export const SPACE_TYPES = [
  { id: "residential", label: "Home or residence" },
  { id: "commercial", label: "Office or commercial" },
  { id: "retail", label: "Retail, restaurant or showroom" },
  { id: "venue", label: "Event venue" },
  { id: "hospitality", label: "Hotel or hospitality" },
  { id: "cultural", label: "Museum, gallery or cultural space" },
  { id: "industrial", label: "Industrial or warehouse" },
  { id: "construction", label: "Construction or renovation site" },
  { id: "other", label: "Something else" },
];
export const OUTPUTS = [
  {
    id: "tour",
    label: "3D virtual tour",
    detail: "A walk-through people can explore online",
  },
  { id: "floorplan", label: "Floor plan" },
  { id: "measurements", label: "Measurements & dimensions" },
  { id: "photos", label: "Photos" },
  { id: "video", label: "Video or aerial footage" },
  { id: "pointcloud", label: "Point cloud, CAD or BIM files" },
];
const NOT_SURE_OUTPUTS = "Not sure — please recommend what fits";
const FLOORS = ["1", "2", "3", "4 or more", "Not sure"].map((label) => ({
  id: label,
  label,
}));
const CEILINGS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "unsure", label: "Not sure" },
];
export const ACCESS = [
  { id: "meet", label: "Someone will meet them and let them in" },
  { id: "desk", label: "Front desk, concierge or security" },
  { id: "lockbox", label: "Lockbox or key pickup" },
  { id: "open", label: "It’s open during business hours" },
  { id: "other", label: "Something else" },
];
const SITE_CONTACT = [
  { id: "me", label: "Me" },
  { id: "other", label: "Someone else" },
  { id: "unsure", label: "Not sure yet" },
];
export const WINDOWS = [
  { id: "morning", label: "Morning", detail: "8 am–12 pm" },
  { id: "afternoon", label: "Afternoon", detail: "12–5 pm" },
  { id: "evening", label: "Evening", detail: "After 5 pm" },
  { id: "any", label: "Any time" },
];
const DEADLINES = [
  { id: "week", label: "Within a week of the visit" },
  { id: "fortnight", label: "Within two weeks of the visit" },
  { id: "date", label: "By a specific date" },
  { id: "none", label: "No fixed deadline" },
];
export const ROLES = [
  { id: "owner", label: "Owner" },
  { id: "manager", label: "Property or facility manager" },
  { id: "agent", label: "Real estate agent or broker" },
  { id: "marketing", label: "Marketing or communications" },
  { id: "events", label: "Event planner" },
  { id: "design", label: "Architect, designer or contractor" },
  { id: "other", label: "Other" },
  { id: "skip", label: "Prefer not to say" },
];
const ADDRESS_KEYS = [
  "address",
  "address2",
  "city",
  "region",
  "postal",
  "country",
];
// Fields the assistant asks itself. A template question on one of these
// changes that step's wording (and choices); other template questions get a
// step of their own.
const CORE_FIELDS = new Set([
  "title",
  ...ADDRESS_KEYS,
  "propertySizeSqFt",
  "scope",
  "deliverables",
  "accessInstructions",
  "contact1Name",
  "contact1Phone",
  "contact2Name",
  "contact2Phone",
  "proposedTimes",
  "deliveryDeadline",
  "requesterName",
  "companyName",
  "notes",
]);
const fieldTypes = new Map(PROJECT_FIELDS.map((f) => [f.key, f.type]));

const fail = (message) => {
  throw new Error(message);
};
// One line of text: whitespace collapsed, no control characters.
function line(value, max, message, required = true) {
  if (typeof value !== "string") fail(message);
  const text = value.replace(/\s+/g, " ").trim();
  if ((required && !text) || text.length > max || /[\x00-\x1f\x7f]/.test(text))
    fail(message);
  return text;
}
// Several lines of text: line breaks kept, other control characters refused.
function block(value, max, message, required = true) {
  if (typeof value !== "string") fail(message);
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (
    (required && !text) ||
    text.length > max ||
    /[\x00-\x09\x0b-\x1f\x7f]/.test(text)
  )
    fail(message);
  return text;
}
const labelOf = (list, id) => list.find((item) => item.id === id)?.label;
const optionsOf = (list) =>
  list.map(({ id, label, detail }) => ({ id, label, detail }));
const oneOf = (list, value, message) =>
  list.some((item) => item.id === value) ? value : fail(message);
const plural = (unit, quantity) =>
  quantity === "1" || /s$|\s/.test(unit) ? unit : `${unit}s`;
export function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function formatDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
// A calendar date from today up to a year ahead, as YYYY-MM-DD.
function futureDate(value, ctx, message) {
  const today = ctx.today || localDate();
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value ||
    value < today ||
    value > limit.toISOString().slice(0, 10)
  )
    fail(message);
  return value;
}
function quantityOf(extra, value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^\./, "0.");
  let units;
  try {
    units = decimalUnits(raw, 2, 10000);
  } catch {
    fail(`Enter a quantity for ${extra.name} with up to two decimals.`);
  }
  if (units > decimalUnits(extra.maxQuantity, 2, 10000))
    fail(`${extra.name} allows at most ${extra.maxQuantity} ${extra.unit}.`);
  if (extra.required && units === 0n)
    fail(`${extra.name} is required. Enter the expected quantity.`);
  return units === 0n ? "0" : raw;
}

// Whether this form can be filled in with the assistant. Forms published
// before provider pricing used a fixed preset estimate; they keep the
// one-page form.
export const assistantSupported = (descriptor) =>
  Boolean(descriptor) &&
  (Object.hasOwn(descriptor, "pricing") || !descriptor.intake?.estimateProfile);
export const emailRequired = (descriptor) =>
  !descriptor.reusable || Boolean(descriptor.verificationRequired);
export const brandName = (descriptor) =>
  descriptor.branding?.name || descriptor.brand || "your provider";
export const welcomeLine = (descriptor) =>
  descriptor.branding?.welcome ||
  `Hi there! I’m ${brandName(descriptor)}’s request assistant, and I’ll help you request a capture of your space.`;
const pricingConfig = (descriptor) => descriptor.pricing?.config || null;

export function requestSteps(descriptor) {
  const brand = brandName(descriptor);
  const config = pricingConfig(descriptor);
  const questions = new Map(
    (descriptor.intake?.questions || []).map((q) => [q.field, q]),
  );
  const asked = (field) => questions.get(field);
  const choicesFor = (field) =>
    asked(field)?.options?.length ? asked(field).options : null;
  const priced =
    config &&
    (config.method !== "quote" ||
      config.extras.length > 0 ||
      budgetAllowed(descriptor));
  const stages = [
    "Welcome",
    "Your space",
    "What you need",
    ...(priced ? ["Estimate"] : []),
    "Access & timing",
    "Contact",
    "Review & send",
  ];
  const stage = (name) => stages.indexOf(name);
  const greeting = (answers) => (answers.name ? `, ${answers.name}` : "");

  // A template question with listed answers becomes a choice step whose value
  // is the chosen answer itself, so the server's answer check passes.
  function templateChoice(id, field, base) {
    const q = asked(field);
    const options = q.options.map((label) => ({ id: label, label }));
    if (!q.required) options.push({ id: "", label: "Not sure yet" });
    return {
      ...base,
      id,
      kind: "choice",
      field,
      prompt: () => ({ text: q.label, hint: q.help || undefined }),
      options: () => options,
      validate: (value) =>
        value === "" && !q.required
          ? ""
          : q.options.includes(value)
            ? value
            : fail(`Choose one of the listed answers for ${q.label}.`),
      summary: (value) => value || "Not sure yet",
    };
  }
  function templateText(id, field, base, fallback) {
    if (choicesFor(field)) return templateChoice(id, field, base);
    const q = asked(field);
    return {
      ...base,
      prompt: (answers, ctx) => {
        const own = fallback.prompt(answers, ctx);
        return q ? { text: q.label, hint: q.help || own.hint } : own;
      },
      optional: q?.required ? undefined : fallback.optional,
      validate: (value) =>
        fallback.validate(value, Boolean(q?.required) || !fallback.optional),
    };
  }

  const steps = [
    {
      id: "name",
      title: "First name",
      label: "Your first name",
      stage: stage("Welcome"),
      kind: "text",
      maxLength: 60,
      autoComplete: "given-name",
      placeholder: "e.g., Jordan",
      prompt: () => ({
        lead: welcomeLine(descriptor),
        text: "First, what’s your first name?",
        hint: "About 3 minutes · nothing is booked or charged here. You can edit any answer before sending.",
      }),
      validate: (value) =>
        line(value, 60, "Tell me your first name, in up to 60 characters."),
      summary: (value) => value,
    },
    {
      id: "spaceType",
      title: "Type of space",
      stage: stage("Your space"),
      kind: "choice",
      prompt: (answers) => ({
        text: `Nice to meet you${greeting(answers)}! What kind of space would you like captured?`,
      }),
      options: () => optionsOf(SPACE_TYPES),
      validate: (value) => oneOf(SPACE_TYPES, value, "Choose a type of space."),
      summary: (value) => labelOf(SPACE_TYPES, value),
    },
    {
      id: "spaceOther",
      title: "Kind of space",
      label: "Kind of space",
      stage: stage("Your space"),
      kind: "text",
      maxLength: 80,
      placeholder: "e.g., Sports arena",
      when: (answers) => answers.spaceType === "other",
      prompt: () => ({ text: "What kind of space is it?" }),
      validate: (value) =>
        line(value, 80, "Describe the space in up to 80 characters."),
      summary: (value) => value,
    },
    templateText(
      "title",
      "title",
      {
        id: "title",
        title: "Property name",
        label: "Property or venue name",
        stage: stage("Your space"),
        kind: "text",
        maxLength: 200,
        placeholder: "e.g., The Harbor Ballroom",
        summary: (value) => value || "Not named yet",
      },
      {
        prompt: () => ({
          text: "What’s the property or venue called?",
          hint: "Optional. The project name can wait until you agree the work.",
        }),
        optional: "Skip — it can wait",
        validate: (value, required) =>
          line(value, 200, "Keep the name under 200 characters.", required),
      },
    ),
    {
      id: "address",
      title: "Address",
      stage: stage("Your space"),
      kind: "form",
      prompt: () => ({
        text: "Where is it?",
        hint: `Used to plan the visit and travel. It’s shared only with ${brand}.`,
      }),
      fields: [
        {
          key: "address",
          label: asked("address")?.label || "Street address",
          autoComplete: "address-line1",
          required: true,
        },
        {
          key: "address2",
          label: asked("address2")?.label || "Unit, suite or floor",
          autoComplete: "address-line2",
        },
        { key: "city", label: "City", autoComplete: "address-level2" },
        {
          key: "region",
          label: "State or region",
          autoComplete: "address-level1",
        },
        { key: "postal", label: "Postal code", autoComplete: "postal-code" },
        { key: "country", label: "Country", autoComplete: "country-name" },
      ].map((field) =>
        choicesFor(field.key)
          ? { ...field, options: choicesFor(field.key) }
          : { ...field, maxLength: 1000 },
      ),
      defaultValue: () =>
        Object.fromEntries(ADDRESS_KEYS.map((key) => [key, ""])),
      validate: (value) => {
        const input = value && typeof value === "object" ? value : {};
        const result = {},
          errors = {};
        for (const key of ADDRESS_KEYS) {
          const choices = choicesFor(key);
          try {
            result[key] = line(
              String(input[key] ?? ""),
              1000,
              key === "address"
                ? "Enter the street address."
                : "Keep this under 1,000 characters.",
              key === "address",
            );
            if (choices && result[key] && !choices.includes(result[key]))
              fail("Choose one of the listed answers.");
          } catch (error) {
            errors[key] = error.message;
          }
        }
        if (Object.keys(errors).length)
          throw Object.assign(new Error(Object.values(errors)[0]), {
            fields: errors,
          });
        return result;
      },
      summary: (value) =>
        [
          value.address,
          value.address2,
          [[value.city, value.region].filter(Boolean).join(", "), value.postal]
            .filter(Boolean)
            .join(" "),
          value.country,
        ].filter(Boolean),
    },
    {
      id: "size",
      title: "Size",
      label: "Approximate size in square feet",
      stage: stage("Your space"),
      kind: "number",
      step: "500",
      unit: () => "sq ft",
      optional: "Not sure",
      prompt: () => ({
        text:
          asked("propertySizeSqFt")?.label || "Roughly how big is the space?",
        hint:
          asked("propertySizeSqFt")?.help ||
          `In square feet (1 m² ≈ 10.8 sq ft). An estimate is fine — ${brand} confirms the size before agreeing a price.`,
      }),
      validate: (value) => {
        const text = String(value ?? "").replace(/[,\s]/g, "");
        if (!text) return "";
        if (!/^\d{1,9}$/.test(text) || Number(text) < 1)
          fail("Enter a whole number of square feet, or choose Not sure.");
        return String(Number(text));
      },
      summary: (value) =>
        value
          ? `${Number(value).toLocaleString("en-US")} sq ft`
          : "Not sure yet",
      dependents: ["estimate"],
    },
    {
      id: "floors",
      title: "Floors or levels",
      stage: stage("Your space"),
      kind: "choice",
      prompt: () => ({ text: "How many floors or levels are included?" }),
      options: () => FLOORS,
      validate: (value) => oneOf(FLOORS, value, "Choose the number of floors."),
      summary: (value) => value,
    },
    {
      id: "ceilings",
      title: "High ceilings",
      stage: stage("Your space"),
      kind: "choice",
      when: (answers) => answers.spaceType !== "residential",
      prompt: () => ({
        text: "Are there any very high ceilings — over about 12 ft (3.5 m), like an atrium, ballroom or warehouse?",
        hint: "High ceilings can change the equipment and time needed.",
      }),
      options: () => CEILINGS,
      validate: (value) => oneOf(CEILINGS, value, "Choose an answer."),
      summary: (value) => labelOf(CEILINGS, value),
    },
    templateText(
      "scope",
      "scope",
      {
        id: "scope",
        title: "What to capture",
        label: "What to capture",
        stage: stage("What you need"),
        kind: "text",
        multiline: true,
        maxLength: 2000,
        placeholder: "e.g., Main hall, lobby and terrace for our venue website",
        suggestions: () => [
          "The whole property",
          "Interior only",
          "Exterior and grounds",
        ],
        summary: (value) => value,
      },
      {
        prompt: (answers) => ({
          text: `What would you like captured${greeting(answers)}?`,
          hint: "Which areas or rooms, and what it’s for — marketing, planning, insurance, an event…",
        }),
        validate: (value) =>
          block(
            value,
            2000,
            "Describe the areas to capture, in up to 2,000 characters.",
          ),
      },
    ),
    choicesFor("deliverables")
      ? templateChoice("deliverables", "deliverables", {
          title: "Results",
          stage: stage("What you need"),
        })
      : {
          id: "deliverables",
          title: "Results",
          stage: stage("What you need"),
          kind: "multi",
          optional: "Not sure — recommend",
          prompt: () => ({
            text:
              asked("deliverables")?.label || "Which results would you like?",
            hint:
              asked("deliverables")?.help ||
              `Pick everything that fits. ${brand} confirms the final list with you.`,
          }),
          options: () => optionsOf(OUTPUTS),
          validate: (value) => {
            const ids = new Set(OUTPUTS.map((item) => item.id));
            if (!Array.isArray(value) || value.some((id) => !ids.has(id)))
              fail("Choose from the listed results.");
            return OUTPUTS.map((item) => item.id).filter((id) =>
              value.includes(id),
            );
          },
          summary: (value) =>
            value.length
              ? value.map((id) => labelOf(OUTPUTS, id))
              : NOT_SURE_OUTPUTS,
          dependents: ["dimensions"],
        },
    {
      id: "dimensions",
      title: "Exact dimensions",
      label: "Rooms where exact dimensions matter",
      stage: stage("What you need"),
      kind: "text",
      maxLength: 300,
      optional: "No specific rooms",
      placeholder: "e.g., Kitchen, stage and loading dock",
      when: (answers) =>
        Array.isArray(answers.deliverables) &&
        answers.deliverables.some((id) =>
          ["floorplan", "measurements"].includes(id),
        ),
      prompt: () => ({
        text: "Are there rooms or areas where exact dimensions matter?",
        hint: `${brand} can plan extra checks there.`,
      }),
      validate: (value) =>
        line(value, 300, "Keep this under 300 characters.", false),
      summary: (value) => value || "No specific rooms",
    },
    ...templateSteps(),
    ...(config ? extraSteps() : []),
    {
      id: "estimate",
      title: "Estimate",
      stage: stage("Estimate"),
      kind: "estimate",
      editable: false,
      when: (answers) =>
        Boolean(config) && config.method !== "quote" && Boolean(answers.size),
      prompt: () => ({
        text: `Here’s your preliminary estimate, using ${brand}’s published prices.`,
        hint: `Not a quote — ${brand} confirms scope, travel, taxes and availability first. No payment or booking happens here.`,
      }),
      validate: (value) =>
        value === true || fail("Review the estimate to continue."),
      summary: (value, answers) => estimateSummary(descriptor, answers),
    },
    {
      id: "budget",
      title: "Budget in mind",
      label: `Budget in ${config?.currency || "USD"}`,
      stage: stage("Estimate"),
      kind: "text",
      inputMode: "decimal",
      maxLength: 16,
      optional: "No budget in mind",
      placeholder: "e.g., 1500",
      when: () => budgetAllowed(descriptor),
      prompt: () => ({
        text: "Do you have a budget in mind?",
        hint: `Optional, in ${config.currency}. It’s a proposal for ${brand} to consider — it doesn’t replace the estimate or agree a fee.`,
      }),
      validate: (value) => {
        const text = String(value ?? "").replace(/[,\s$€£]/g, "");
        if (!text) return "";
        let units;
        try {
          units = decimalUnits(text, 2, 100000000);
        } catch {
          fail("Enter an amount with up to two decimals, or skip.");
        }
        if (units === 0n) fail("Enter an amount above zero, or skip.");
        return text;
      },
      summary: (value) =>
        value ? `${config.currency} ${value}` : "No budget in mind",
    },
    choicesFor("accessInstructions")
      ? templateChoice("access", "accessInstructions", {
          title: "Access",
          stage: stage("Access & timing"),
        })
      : {
          id: "access",
          title: "Access",
          stage: stage("Access & timing"),
          kind: "choice",
          prompt: () => ({
            text: "How will the provider get into the space?",
            hint: `Please don’t share door or alarm codes here. Send them once ${brand} confirms the visit.`,
          }),
          options: () => optionsOf(ACCESS),
          validate: (value) => oneOf(ACCESS, value, "Choose how access works."),
          summary: (value) => labelOf(ACCESS, value),
          dependents: ["accessDetail"],
        },
    {
      id: "accessDetail",
      title: "Access details",
      label: "Access details",
      stage: stage("Access & timing"),
      kind: "text",
      multiline: true,
      maxLength: 1000,
      placeholder: "e.g., Park in the rear lot and sign in at security",
      when: () => !choicesFor("accessInstructions"),
      optional: (answers) =>
        answers.access === "other" ? undefined : "Nothing else",
      prompt: () => ({
        text:
          asked("accessInstructions")?.label ||
          "Anything else about getting in — parking, a loading dock, security sign-in?",
        hint:
          asked("accessInstructions")?.help ||
          "Again, no door or alarm codes here.",
      }),
      validate: (value, answers) =>
        block(
          value,
          1000,
          answers.access === "other"
            ? "Describe how the provider gets in."
            : "Keep this under 1,000 characters.",
          answers.access === "other",
        ),
      summary: (value) => value || "Nothing else",
    },
    {
      id: "siteContact",
      title: "On-site contact",
      stage: stage("Access & timing"),
      kind: "choice",
      prompt: () => ({ text: `Who will meet ${brand} on site?` }),
      options: () => SITE_CONTACT,
      validate: (value) =>
        oneOf(SITE_CONTACT, value, "Choose who will meet the provider."),
      summary: (value) => labelOf(SITE_CONTACT, value),
    },
    {
      id: "sitePerson",
      title: "On-site contact details",
      stage: stage("Access & timing"),
      kind: "form",
      when: (answers) => answers.siteContact === "other",
      prompt: () => ({ text: "Who should they ask for?" }),
      fields: [
        { key: "name", label: "Name", autoComplete: "off", required: true },
        { key: "phone", label: "Phone", type: "tel", autoComplete: "off" },
      ],
      defaultValue: () => ({ name: "", phone: "" }),
      validate: (value) => person(value, { name: true }),
      summary: (value) => [value.name, value.phone].filter(Boolean),
    },
    choicesFor("proposedTimes")
      ? templateChoice("times", "proposedTimes", {
          title: "Visit timing",
          stage: stage("Access & timing"),
        })
      : {
          id: "times",
          title: "Visit timing",
          stage: stage("Access & timing"),
          kind: "availability",
          prompt: () => ({
            text:
              asked("proposedTimes")?.label || "When could the visit happen?",
            hint:
              asked("proposedTimes")?.help ||
              `Pick up to three dates and a time of day, or say you’re flexible. Times are local to the property, and ${brand} confirms the appointment.`,
          }),
          defaultValue: () => ({ slots: [], flexible: false }),
          validate: (value, answers, ctx = {}) => availability(value, ctx),
          summary: (value) => availabilityLines(value),
        },
    choicesFor("deliveryDeadline")
      ? templateChoice("deadline", "deliveryDeadline", {
          title: "Results needed",
          stage: stage("Access & timing"),
        })
      : {
          id: "deadline",
          title: "Results needed",
          stage: stage("Access & timing"),
          kind: "choice",
          prompt: () => ({
            text:
              asked("deliveryDeadline")?.label ||
              "When do you need the finished results?",
            hint: asked("deliveryDeadline")?.help || undefined,
          }),
          options: () => optionsOf(DEADLINES),
          validate: (value) =>
            oneOf(DEADLINES, value, "Choose when you need the results."),
          summary: (value) => labelOf(DEADLINES, value),
          dependents: ["deadlineDate"],
        },
    {
      id: "deadlineDate",
      title: "Results needed by",
      label: "Date needed",
      stage: stage("Access & timing"),
      kind: "date",
      when: (answers) => answers.deadline === "date",
      prompt: () => ({ text: "What date do you need them by?" }),
      validate: (value, answers, ctx = {}) =>
        futureDate(value, ctx, "Choose a date from today up to a year ahead."),
      summary: (value) => formatDay(value),
    },
    {
      id: "contact",
      title: "Your details",
      stage: stage("Contact"),
      kind: "form",
      prompt: (answers) => ({
        text: `Almost done${greeting(answers)}! How can ${brand} reach you?`,
        hint: emailRequired(descriptor)
          ? `We’ll email you a link to confirm your request before it goes to ${brand}.`
          : "Email is optional, for replies about this request.",
      }),
      fields: [
        {
          key: "name",
          label: asked("requesterName")?.label || "Full name",
          autoComplete: "name",
          required: true,
        },
        {
          key: "company",
          label: asked("companyName")?.label || "Organisation",
          autoComplete: "organization",
          ...(choicesFor("companyName")
            ? { options: choicesFor("companyName") }
            : {}),
        },
        { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
        {
          key: "email",
          label: "Email",
          type: "email",
          autoComplete: "email",
          required: emailRequired(descriptor),
        },
      ],
      defaultValue: (answers) => ({
        name: answers.name || "",
        company: "",
        phone: "",
        email: "",
      }),
      validate: (value) => {
        const input = value && typeof value === "object" ? value : {};
        const errors = {};
        let result = { name: "", company: "", phone: "", email: "" };
        try {
          result = { ...result, ...person(input, { name: true }) };
        } catch (error) {
          Object.assign(errors, error.fields);
        }
        try {
          result.company = line(
            String(input.company ?? ""),
            200,
            "Keep the organisation under 200 characters.",
            false,
          );
          const choices = choicesFor("companyName");
          if (choices && result.company && !choices.includes(result.company))
            fail("Choose one of the listed answers.");
        } catch (error) {
          errors.company = error.message;
        }
        const email = String(input.email ?? "").trim();
        if (
          (email || emailRequired(descriptor)) &&
          (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        )
          errors.email = "Enter a valid email address, like you@example.com.";
        result.email = email;
        if (Object.keys(errors).length)
          throw Object.assign(new Error(Object.values(errors)[0]), {
            fields: errors,
          });
        return result;
      },
      summary: (value) =>
        [value.name, value.company, value.phone, value.email].filter(Boolean),
    },
    {
      id: "role",
      title: "Your role",
      stage: stage("Contact"),
      kind: "choice",
      prompt: () => ({ text: "And what’s your role?" }),
      options: () => optionsOf(ROLES),
      validate: (value) => oneOf(ROLES, value, "Choose a role."),
      summary: (value) => labelOf(ROLES, value),
    },
    templateText(
      "notes",
      "notes",
      {
        id: "notes",
        title: "Anything else",
        label: "Anything else",
        stage: stage("Contact"),
        kind: "text",
        multiline: true,
        maxLength: 2000,
        summary: (value) => value || "Nothing else",
      },
      {
        prompt: () => ({ text: `Anything else ${brand} should know?` }),
        optional: "Nothing else",
        validate: (value, required) =>
          block(value, 2000, "Keep this under 2,000 characters.", required),
      },
    ),
    {
      id: "review",
      title: "Request sent",
      stage: stage("Review & send"),
      kind: "review",
      editable: false,
      prompt: (answers) => ({
        text: `Here’s your request${greeting(answers)}. Check anything you like, then send it to ${brand}.`,
      }),
      validate: (value) =>
        value && typeof value === "object" && typeof value.message === "string"
          ? value
          : fail("Send your request to continue."),
      summary: () => "Request sent",
    },
  ];

  // Template questions on fields the assistant doesn't ask itself, in the
  // provider's order. Their conditions use the fields answered so far.
  function templateSteps() {
    return [...questions.values()]
      .filter((q) => !CORE_FIELDS.has(q.field) && CLIENT_FIELDS.has(q.field))
      .map((q) => {
        const base = {
          id: `q:${q.field}`,
          title: q.label,
          label: q.label,
          stage: stage("What you need"),
          field: q.field,
          dependsOn: q.when?.field,
          when: (answers) =>
            questionApplies(q, requestFields(descriptor, answers)),
        };
        if (q.options?.length) return templateChoice(base.id, q.field, base);
        const type = fieldTypes.get(q.field);
        return {
          ...base,
          kind: "text",
          multiline: type === "textarea",
          inputType: type === "url" ? "url" : undefined,
          maxLength: type === "textarea" ? 2000 : 1000,
          optional: q.required ? undefined : "Skip",
          placeholder: type === "url" ? "https://" : undefined,
          prompt: () => ({ text: q.label, hint: q.help || undefined }),
          validate: (value) => {
            const text =
              type === "textarea"
                ? block(
                    value,
                    2000,
                    `Keep ${q.label} under 2,000 characters.`,
                    q.required,
                  )
                : line(
                    value,
                    1000,
                    `Keep ${q.label} under 1,000 characters.`,
                    q.required,
                  );
            if (text && type === "url") {
              let url;
              try {
                url = new URL(text);
              } catch {
                fail("Use a full link starting with https://.");
              }
              if (url.protocol !== "https:")
                fail("Use a secure link starting with https://.");
            }
            return text;
          },
          summary: (value) => value || "Skipped",
        };
      });
  }
  function extraSteps() {
    return config.extras.map((extra) => ({
      id: `extra:${extra.id}`,
      title: extra.name,
      label: `${extra.name} quantity (${extra.unit})`,
      stage: stage("Estimate"),
      kind: "quantity",
      extra,
      currency: config.currency,
      prompt: () => ({
        text: extra.required
          ? `How much ${extra.name} will you need?`
          : `Would you like to add ${extra.name}?`,
        hint: `${config.currency} ${extra.price} per ${extra.unit}${extra.required ? " · required" : " · optional"}. Up to ${extra.maxQuantity} ${plural(extra.unit, extra.maxQuantity)}.`,
      }),
      defaultValue: () => (extra.required ? extra.defaultQuantity : ""),
      validate: (value) => quantityOf(extra, value),
      summary: (value) =>
        value === "0" ? "No thanks" : `${value} ${plural(extra.unit, value)}`,
      dependents: ["estimate"],
    }));
  }
  return { stages, steps: afterDependencies(steps) };
}

// The project fields each step's answer writes (see requestFields).
const CONTACT_FIELDS = [
  "contact1Name",
  "contact1Phone",
  "contact2Name",
  "contact2Phone",
];
const WRITES = {
  title: ["title"],
  address: ADDRESS_KEYS,
  size: ["propertySizeSqFt"],
  scope: ["scope"],
  deliverables: ["deliverables"],
  access: ["accessInstructions"],
  accessDetail: ["accessInstructions"],
  siteContact: CONTACT_FIELDS,
  sitePerson: CONTACT_FIELDS,
  times: ["proposedTimes"],
  deadline: ["deliveryDeadline"],
  deadlineDate: ["deliveryDeadline"],
  contact: ["requesterName", "companyName", ...CONTACT_FIELDS],
  spaceType: ["notes"],
  spaceOther: ["notes"],
  floors: ["notes"],
  ceilings: ["notes"],
  dimensions: ["notes"],
  role: ["notes"],
  notes: ["notes"],
};
const writes = (step, field) =>
  step.id === `q:${field}` || Boolean(WRITES[step.id]?.includes(field));
// A template question is asked only after every step that answers the field
// its condition reads, so a later answer can still make it apply. Template
// conditions are acyclic, so this settles.
function afterDependencies(steps) {
  const list = [...steps];
  for (let moved = true; moved;) {
    moved = false;
    for (const id of steps.filter((s) => s.dependsOn).map((s) => s.id)) {
      const at = list.findIndex((s) => s.id === id),
        step = list[at];
      const last = list.findLastIndex((s) => writes(s, step.dependsOn));
      if (last > at) {
        list.splice(at, 1);
        list.splice(last, 0, { ...step, stage: list[last - 1].stage });
        moved = true;
      }
    }
  }
  return list;
}
function person(value, { name }) {
  const input = value && typeof value === "object" ? value : {};
  const errors = {},
    result = { name: "", phone: "" };
  try {
    result.name = line(
      String(input.name ?? ""),
      200,
      "Enter a name of up to 200 characters.",
      name,
    );
  } catch (error) {
    errors.name = error.message;
  }
  try {
    result.phone = formatPhone(brandingPhone(String(input.phone ?? "")));
  } catch (error) {
    errors.phone = error.message;
  }
  if (Object.keys(errors).length)
    throw Object.assign(new Error(Object.values(errors)[0]), {
      fields: errors,
    });
  return result;
}
function availability(value, ctx) {
  const input = value && typeof value === "object" ? value : {};
  const slots = Array.isArray(input.slots) ? input.slots : [];
  const flexible = input.flexible === true;
  if (!flexible && !slots.length)
    fail("Add at least one date, or choose I’m flexible.");
  if (slots.length > 3) fail("Choose up to three dates.");
  const clean = slots.map((slot) => ({
    date: futureDate(
      slot?.date,
      ctx,
      "Choose dates from today up to a year ahead.",
    ),
    window: oneOf(WINDOWS, slot?.window, "Choose a time of day for each date."),
  }));
  if (new Set(clean.map((slot) => slot.date)).size !== clean.length)
    fail("Choose each date only once.");
  return {
    slots: clean.sort((a, b) => a.date.localeCompare(b.date)),
    flexible,
  };
}
export function availabilityLines(value) {
  const lines = value.slots.map((slot) => {
    const window = WINDOWS.find((item) => item.id === slot.window);
    return `${formatDay(slot.date)} · ${window.label}${window.detail ? ` (${window.detail})` : ""}`;
  });
  if (value.flexible)
    lines.push(
      lines.length
        ? "Other times may work too"
        : "Flexible — please suggest times",
    );
  return lines;
}

// The project fields this request sends, from the answers that still apply.
export function requestFields(descriptor, answers) {
  const fields = {};
  const set = (key, value) => {
    if (typeof value === "string" && value.trim()) fields[key] = value.trim();
  };
  set("title", answers.title);
  for (const key of ADDRESS_KEYS) set(key, answers.address?.[key]);
  set("propertySizeSqFt", answers.size);
  set("scope", answers.scope);
  if (Array.isArray(answers.deliverables))
    set(
      "deliverables",
      answers.deliverables.length
        ? answers.deliverables.map((id) => labelOf(OUTPUTS, id)).join("\n")
        : NOT_SURE_OUTPUTS,
    );
  else set("deliverables", answers.deliverables);
  if (typeof answers.access === "string") {
    const access = labelOf(ACCESS, answers.access);
    set(
      "accessInstructions",
      access
        ? [access, answers.accessDetail].filter(Boolean).join("\n")
        : answers.access,
    );
  }
  const contact = answers.contact || {};
  set("requesterName", contact.name);
  set("companyName", contact.company);
  // The on-site contact comes first; the requester is the second contact when
  // someone else meets the provider.
  if (answers.siteContact === "other" && answers.sitePerson) {
    set("contact1Name", answers.sitePerson.name);
    set("contact1Phone", answers.sitePerson.phone);
    if (contact.phone) {
      set("contact2Name", contact.name);
      set("contact2Phone", contact.phone);
    }
  } else if (contact.name || contact.phone) {
    if (answers.siteContact === "me") set("contact1Name", contact.name);
    set("contact1Phone", contact.phone);
  }
  if (answers.times && typeof answers.times === "object")
    set(
      "proposedTimes",
      [
        ...availabilityLines(answers.times),
        "Times are local to the property.",
      ].join("\n"),
    );
  else set("proposedTimes", answers.times);
  if (typeof answers.deadline === "string") {
    const deadline =
      answers.deadline === "date" && answers.deadlineDate
        ? `By ${formatDay(answers.deadlineDate)}`
        : answers.deadline === "date"
          ? ""
          : (labelOf(DEADLINES, answers.deadline) ?? answers.deadline);
    set("deliveryDeadline", deadline);
  }
  for (const [id, value] of Object.entries(answers))
    if (id.startsWith("q:")) set(id.slice(2), value);
  const facts = [
    answers.spaceType &&
      `Space type: ${answers.spaceType === "other" && answers.spaceOther ? answers.spaceOther : labelOf(SPACE_TYPES, answers.spaceType)}`,
    answers.floors && `Floors or levels: ${answers.floors}`,
    answers.ceilings &&
      `Ceilings over about 12 ft: ${labelOf(CEILINGS, answers.ceilings)}`,
    answers.dimensions && `Exact dimensions needed for: ${answers.dimensions}`,
    answers.role &&
      answers.role !== "skip" &&
      `Requester role: ${labelOf(ROLES, answers.role)}`,
  ].filter(Boolean);
  set("notes", [answers.notes, ...facts].filter(Boolean).join("\n"));
  return fields;
}
export function requestQuantities(descriptor, answers) {
  const config = pricingConfig(descriptor);
  if (!config) return {};
  return Object.fromEntries(
    config.extras.map((extra) => [
      extra.id,
      answers[`extra:${extra.id}`] ??
        (extra.required ? extra.defaultQuantity : "0"),
    ]),
  );
}
export function requestEstimate(descriptor, answers) {
  const config = pricingConfig(descriptor);
  if (!config) return null;
  try {
    return calculatePricing(
      config,
      answers.size || "",
      requestQuantities(descriptor, answers),
    );
  } catch {
    return null;
  }
}
export function estimateSummary(descriptor, answers) {
  const estimate = requestEstimate(descriptor, answers);
  if (!estimate) return `${brandName(descriptor)} will prepare a quote`;
  if (estimate.totalCents != null)
    return `Estimated total ${estimateMoney(estimate.totalCents, estimate.currency)} · not a quote`;
  return estimate.lines.length
    ? `Extras ${estimateMoney(estimate.subtotalCents, estimate.currency)}; base price to be quoted`
    : `${brandName(descriptor)} will prepare a quote`;
}
// The body the existing intake actions accept (public/submit, prospect/request).
export function requestBody(descriptor, answers, token) {
  const modern = Object.hasOwn(descriptor, "pricing");
  return {
    token,
    email: answers.contact?.email || "",
    fields: requestFields(descriptor, answers),
    creative: false,
    ...(modern
      ? {
          pricingKey: pricingKey(descriptor),
          quantities: requestQuantities(descriptor, answers),
          budget: budgetAllowed(descriptor) ? answers.budget || "" : "",
        }
      : {}),
  };
}
export function requestFlow(descriptor) {
  const { stages, steps } = requestSteps(descriptor);
  return { stages, ...createFlow(steps) };
}

// Drafts stay on this device for seven days after the last change, keyed by
// a digest of the form or invitation token (never the token itself).
export function requestKey(token) {
  let a = 0x811c9dc5,
    b = 0x01000193;
  for (const char of String(token)) {
    const code = char.codePointAt(0);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return (
    REQUEST_PREFIX +
    a.toString(16).padStart(8, "0") +
    b.toString(16).padStart(8, "0")
  );
}
export const newRequest = (now = Date.now()) => ({
  version: 1,
  status: "active",
  answers: {},
  done: [],
  startedAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  expiresAt: now + REQUEST_KEEP_DAYS * DAY,
});
function validRequest(value, now) {
  return (
    value?.version === 1 &&
    ["active", "complete"].includes(value.status) &&
    value.answers &&
    typeof value.answers === "object" &&
    !Array.isArray(value.answers) &&
    Array.isArray(value.done) &&
    value.done.every((id) => typeof id === "string") &&
    Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt > now
  );
}
// Expired drafts from any form are removed whenever one is read.
export function readRequest(
  token,
  storage = globalThis.localStorage,
  now = Date.now(),
) {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (!key?.startsWith(REQUEST_PREFIX)) continue;
      let expired = true;
      try {
        expired = !validRequest(JSON.parse(storage.getItem(key)), now);
      } catch {
        /* unreadable drafts are removed */
      }
      if (expired) storage.removeItem(key);
    }
    const value = JSON.parse(storage.getItem(requestKey(token)) || "null");
    return validRequest(value, now) ? value : null;
  } catch {
    return null;
  }
}
export function writeRequest(
  token,
  state,
  storage = globalThis.localStorage,
  now = Date.now(),
) {
  try {
    storage.setItem(
      requestKey(token),
      JSON.stringify({ ...state, expiresAt: now + REQUEST_KEEP_DAYS * DAY }),
    );
    return true;
  } catch {
    return false;
  }
}
export function clearRequest(token, storage = globalThis.localStorage) {
  try {
    storage.removeItem(requestKey(token));
  } catch {
    /* nothing was stored */
  }
}
