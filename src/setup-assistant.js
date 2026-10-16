// The setup assistant is an ordered list of conditional steps. Each answer is
// validated, committed to this device immediately, and the next question is
// the first applicable step that is not yet confirmed. Editing an answer
// re-asks only that step; steps that depend on it are re-asked as well.
import {
  brandingArea,
  brandingPhone,
  validateBranding,
} from "./provider-branding.js";
import {
  blankPricing,
  decimalUnits,
  validatePricing,
} from "./provider-pricing.js";

export const SETUP_KEY = "streamlion-setup-v1";
export const STAGES = [
  "About you",
  "Contact",
  "Your work",
  "Storage",
  "Pricing & units",
  "Finish",
];

export const FOCUS = [
  {
    id: "requests",
    label: "Client requests & quotes",
    detail: "Branded request forms with your prices",
  },
  {
    id: "briefs",
    label: "Project briefs & prep",
    detail: "Turn client briefs into job plans",
  },
  {
    id: "field",
    label: "On-site notes & measurements",
    detail: "Room readings, photos and site exceptions",
  },
  {
    id: "handover",
    label: "Client handovers",
    detail: "Delivery checklists and handover reports",
  },
];
const MATTERPORT = ["matterport-pro3", "matterport-pro2"];
export const HARDWARE = [
  { id: "matterport-pro3", label: "Matterport Pro3" },
  { id: "matterport-pro2", label: "Matterport Pro2" },
  { id: "insta360", label: "Insta360 (X3 / X4 / 1-inch 360)" },
  { id: "ricoh-theta", label: "Ricoh Theta (Z1 / X)" },
  { id: "leica-blk360", label: "Leica BLK360" },
  { id: "drone", label: "Drone / aerial" },
  { id: "lidar", label: "Mobile LiDAR / phone" },
  { id: "dslr", label: "DSLR / mirrorless" },
  { id: "other", label: "Other / custom" },
];
const DELIVERABLES = [
  { id: "space", label: "Matterport Space link", for: MATTERPORT },
  {
    id: "transfer",
    label: "Matterport Model Transfer",
    detail: "Captured on my account, then transferred to the client’s",
    for: MATTERPORT,
  },
  { id: "schematic", label: "Schematic floor plan", for: MATTERPORT },
  { id: "matterpak", label: "MatterPak bundle (OBJ / XYZ)", for: MATTERPORT },
  {
    id: "e57",
    label: "E57 point cloud",
    for: [...MATTERPORT, "leica-blk360", "lidar"],
  },
  {
    id: "pointcloud",
    label: "Registered point cloud (LAS / RCP)",
    for: ["leica-blk360", "lidar"],
  },
  {
    id: "bim",
    label: "CAD / BIM model",
    for: [...MATTERPORT, "leica-blk360", "lidar"],
  },
  {
    id: "tour",
    label: "360° virtual tour link",
    for: ["insta360", "ricoh-theta", "dslr", "other"],
  },
  {
    id: "panoramas",
    label: "360° panoramas (equirectangular)",
    for: ["insta360", "ricoh-theta", "dslr"],
  },
  { id: "aerial", label: "Aerial photos & video", for: ["drone"] },
  { id: "orthomosaic", label: "Orthomosaic map", for: ["drone"] },
  {
    id: "stills",
    label: "Still photography",
    for: HARDWARE.map((h) => h.id).filter((id) => id !== "lidar"),
  },
  {
    id: "floorplan",
    label: "Measured floor plan",
    for: HARDWARE.map((h) => h.id),
  },
];
export const TOUR_HOSTS = [
  { id: "kuula", label: "Kuula" },
  { id: "cloudpano", label: "CloudPano" },
  { id: "3dvista", label: "3DVista" },
  { id: "matterport", label: "Matterport (360 upload)" },
  { id: "website", label: "My own website" },
  { id: "export", label: "Direct file export" },
  { id: "other", label: "Other" },
];
const TOUR_CAMERAS = ["insta360", "ricoh-theta", "other"];
export const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD"];
const PRICING_CHOICES = {
  quote: "I quote each job myself",
  area: "One rate per square foot",
  tiers: "Rates that change with property size",
  flat: "Flat fee by property size",
  skip: "Skip pricing for now",
};
const TIER_STYLES = {
  whole: "One rate for the whole property",
  progressive: "Price each size band separately",
};
export const TIER_DEFAULTS = {
  tiers: [
    { upTo: "5000", price: "0.15" },
    { upTo: "19999", price: "0.12" },
    { upTo: "", price: "0.10" },
  ],
  flat: [
    { upTo: "5000", price: "350" },
    { upTo: "20000", price: "750" },
    { upTo: "", price: "1200" },
  ],
};

const fail = (message) => {
  throw new Error(message);
};
const plain = (value, max, message, required = true) => {
  if (typeof value !== "string") fail(message);
  const text = value.replace(/\s+/g, " ").trim();
  if ((required && !text) || text.length > max || /[\x00-\x1f\x7f]/.test(text))
    fail(message);
  return text;
};
const has = (answers, step, id) =>
  Array.isArray(answers[step]) && answers[step].includes(id);
const pick = (list, value, message, { min = 1 } = {}) => {
  const ids = new Set(list.map((item) => item.id));
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.some((id) => !ids.has(id))
  )
    fail(message);
  return list.map((item) => item.id).filter((id) => value.includes(id));
};
const labels = (list, ids = []) =>
  list.filter((item) => ids.includes(item.id)).map((item) => item.label);
const oneOf = (choices, value, message) =>
  Object.hasOwn(choices, value) ? value : fail(message);
const options = (choices) =>
  Object.entries(choices).map(([id, label]) => ({ id, label }));
const yesNo = (yes, no) => [
  { id: "yes", label: yes },
  { id: "no", label: no },
];
const priced = (answers) =>
  ["area", "tiers", "flat"].includes(answers.pricingMethod);
export function formatPhone(value) {
  const digits = value.replace(/\D/g, "");
  // Only plain ten-digit or +1 numbers are reformatted; others keep their form.
  if (/^[\d\s().-]+$/.test(value) && digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (/^\+1[\d\s().-]+$/.test(value) && digits.length === 11)
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value;
}
export function normalizeWebsite(value) {
  const text = value.trim();
  if (!text) return "";
  const address = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  return validateBranding({ name: "Website", website: address }).website;
}
const REGION_CURRENCY = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  AU: "AUD",
  NZ: "NZD",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  FI: "EUR",
};
export function currencyForLocale(locale = "") {
  const region = /[-_]([A-Z]{2})\b/.exec(String(locale))?.[1];
  return REGION_CURRENCY[region] || "USD";
}
export function deliverableOptions(answers) {
  const hardware = answers.hardware || [];
  return DELIVERABLES.filter((item) =>
    item.for.some((id) => hardware.includes(id)),
  );
}
export function pricingConfig(answers) {
  const method = answers.pricingMethod;
  if (!method || method === "skip") return null;
  const tierMethod = method === "tiers" ? answers.tierStyle : method;
  return validatePricing({
    ...blankPricing(),
    currency: answers.currency || "USD",
    method: tierMethod,
    rate: method === "area" ? answers.rate : blankPricing().rate,
    tiers: ["tiers", "flat"].includes(method) ? answers.tiers : [],
    allowBudget: answers.budget === "yes",
    budgetPerClient: answers.budget === "per-client",
  });
}
function money(value, places) {
  const text = String(value ?? "")
    .trim()
    .replace(/^\./, "0.");
  if (decimalUnits(text, places) === 0n) fail("Enter an amount above zero.");
  return text;
}

// prompt(answers, ctx) → { text, hint }. ctx carries runtime facts that are
// never stored: online, connected, account, checking, googleAvailable,
// workbookReady, bookId and siteCopy.
export const STEPS = [
  {
    id: "name",
    title: "Name",
    label: "What should I call you?",
    stage: 0,
    kind: "text",
    prompt: () => ({
      text: "Hey there, I’m your StreamLion onboarding assistant and glad to help you get things situated. What should I call you?",
      hint: "Answer one question at a time. You can edit any answer later.",
    }),
    placeholder: "e.g., Alex",
    autoComplete: "given-name",
    validate: (value) =>
      plain(value, 60, "Tell me what to call you, in up to 60 characters."),
    summary: (value) => value,
  },
  {
    id: "business",
    title: "Name on project material",
    label: "Business or trade name",
    stage: 0,
    kind: "text",
    prompt: (answers) => ({
      text: `Nice to meet you, ${answers.name}! What name should we use in your project material?`,
      hint: "It appears on your client request pages, project records and handover reports.",
    }),
    placeholder: "e.g., Harbor Spatial Capture",
    autoComplete: "organization",
    suggestions: (answers) => [answers.name],
    validate: (value) => validateBranding({ name: value }).name,
    summary: (value) => value,
  },
  {
    id: "contact",
    title: "Contact details",
    stage: 1,
    kind: "form",
    prompt: () => ({
      text: "Great. Which contact details should clients see on work orders and project summaries?",
      hint: "Only the email is required. Phone, service area and website appear on your client request pages and handovers.",
    }),
    fields: [
      {
        key: "email",
        label: "Business email",
        type: "email",
        autoComplete: "email",
        required: true,
      },
      { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
      {
        key: "area",
        label: "Service area or business address",
        autoComplete: "street-address",
        placeholder: "e.g., Portland, OR and surrounding areas",
      },
      {
        key: "website",
        label: "Website",
        type: "url",
        autoComplete: "url",
        placeholder: "your-business.com",
      },
    ],
    defaultValue: (answers, ctx) => ({
      email: ctx.account || "",
      phone: "",
      area: "",
      website: "",
    }),
    validate: (value) => {
      const errors = {};
      const result = { email: "", phone: "", area: "", website: "" };
      const input = value && typeof value === "object" ? value : {};
      const email = String(input.email ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        errors.email = "Enter a valid email address, like you@business.com.";
      result.email = email;
      // Phone and service area follow the same rules as saved branding.
      try {
        result.phone = formatPhone(brandingPhone(String(input.phone ?? "")));
      } catch (error) {
        errors.phone = error.message;
      }
      try {
        result.area = brandingArea(String(input.area ?? ""));
      } catch (error) {
        errors.area = error.message;
      }
      try {
        result.website = normalizeWebsite(String(input.website ?? ""));
      } catch (error) {
        errors.website = error.message;
      }
      if (Object.keys(errors).length) {
        const error = new Error(Object.values(errors)[0]);
        error.fields = errors;
        throw error;
      }
      return result;
    },
    summary: (value) =>
      [value.email, value.phone, value.area, value.website].filter(Boolean),
  },
  {
    id: "focus",
    title: "How you’ll use StreamLion",
    stage: 2,
    kind: "multi",
    prompt: () => ({
      text: "How do you plan to use StreamLion? Pick everything that fits, and I’ll tailor the rest of setup.",
    }),
    options: () => FOCUS,
    validate: (value) => pick(FOCUS, value, "Pick at least one way you work."),
    summary: (value) => labels(FOCUS, value).join(", "),
  },
  {
    id: "hardware",
    title: "Capture systems",
    stage: 2,
    kind: "multi",
    prompt: () => ({
      text: "StreamLion works alongside your camera and scan software. Which capture systems do you use in the field?",
    }),
    options: () => HARDWARE,
    validate: (value) =>
      pick(HARDWARE, value, "Pick at least one capture system."),
    summary: (value) => labels(HARDWARE, value).join(", "),
    dependents: ["hardwareOther", "deliverables", "tourHosting"],
  },
  {
    id: "hardwareOther",
    title: "Other capture system",
    label: "Other capture system",
    stage: 2,
    kind: "text",
    when: (answers) => has(answers, "hardware", "other"),
    prompt: () => ({ text: "Which other capture system do you use?" }),
    placeholder: "e.g., NavVis VLX",
    validate: (value) =>
      plain(value, 80, "Name the system in up to 80 characters."),
    summary: (value) => value,
  },
  {
    id: "deliverables",
    title: "Usual deliverables",
    stage: 2,
    kind: "multi",
    optional: "None of these",
    prompt: (answers) => ({
      text: answers.hardware?.some((id) => MATTERPORT.includes(id))
        ? "Which Matterport and other deliverables do you usually hand over?"
        : "Which deliverables do you usually hand over?",
      hint: "New projects can start their checklist from these.",
    }),
    options: deliverableOptions,
    validate: (value, answers) =>
      pick(
        deliverableOptions(answers),
        value,
        "Choose from the listed deliverables.",
        { min: 0 },
      ),
    summary: (value, answers) =>
      labels(deliverableOptions(answers), value).join(", ") ||
      "None of these yet",
  },
  {
    id: "tourHosting",
    title: "360° tour hosting",
    stage: 2,
    kind: "multi",
    optional: "Not sure yet",
    when: (answers) => TOUR_CAMERAS.some((id) => has(answers, "hardware", id)),
    prompt: () => ({
      text: "Where do you host 360° tours from those cameras?",
    }),
    options: () => TOUR_HOSTS,
    validate: (value) =>
      pick(TOUR_HOSTS, value, "Choose from the listed platforms.", {
        min: 0,
      }),
    summary: (value) => labels(TOUR_HOSTS, value).join(", ") || "Not sure yet",
  },
  {
    id: "storage",
    title: "Where records live",
    stage: 3,
    kind: "choice",
    prompt: (answers, ctx) => ({
      text: ctx.connected
        ? `You’re signed in to Google as ${ctx.account || "your account"}. Should StreamLion keep your project records there?`
        : "StreamLion keeps your project briefs, measurements and evidence in your own Google Drive and Sheets. You own your data completely. Would you like to connect Google now, or start on this device?",
      hint:
        ctx.online === false
          ? "You’re offline right now, so Google will have to wait. Device work stays available offline."
          : ctx.googleAvailable === false
            ? "Google sign-in isn’t available in this StreamLion app right now."
            : "Starting on this device is fine. You can connect Google later from Account.",
    }),
    options: (answers, ctx) => [
      {
        id: "google",
        label: ctx.connected
          ? "Use my Google account"
          : "Connect Google (recommended)",
        detail: "Records sync to Sheets and Drive",
        disabled: ctx.online === false || ctx.googleAvailable === false,
      },
      {
        id: "device",
        label: "Start on this device",
        detail: "Set up Google later",
      },
    ],
    validate: (value, answers, ctx) => {
      oneOf({ google: 1, device: 1 }, value, "Choose where records live.");
      if (value === "google" && ctx.online === false)
        fail("You’re offline. Start on this device for now.");
      if (value === "google" && ctx.googleAvailable === false)
        fail("Google sign-in isn’t available right now.");
      return value;
    },
    summary: (value) =>
      value === "google" ? "Keep my records in Google" : "Start on this device",
    dependents: ["google", "workbook", "siteCopy"],
  },
  {
    id: "google",
    title: "Google account",
    stage: 3,
    kind: "google",
    action: true,
    editable: false,
    when: (answers) => answers.storage === "google",
    satisfied: (ctx) =>
      ctx.connected ? { account: ctx.account || "" } : undefined,
    prompt: () => ({
      text: "Let’s connect your Google account. Google will ask you to confirm access.",
    }),
    validate: (value) => value,
    summary: (value) =>
      value?.account
        ? `Signed in as ${value.account}`
        : "Signed in with Google",
  },
  {
    id: "workbook",
    title: "Workbook",
    stage: 3,
    kind: "workbook",
    action: true,
    editable: false,
    when: (answers, ctx) => answers.storage === "google" && !!ctx.connected,
    satisfied: (ctx, stored) =>
      ctx.workbookReady
        ? stored?.bookId === ctx.bookId
          ? stored
          : { bookId: ctx.bookId, how: "existing" }
        : undefined,
    prompt: () => ({
      text: "You’re connected. Your projects live in a StreamLion workbook in your Drive. Should I create one, or use an existing workbook?",
    }),
    validate: (value) => value,
    summary: (value) =>
      value?.how === "created"
        ? "Created a workbook in my StreamLion folder"
        : value?.how === "picked"
          ? "Use my existing workbook"
          : "Use my saved workbook",
  },
  {
    id: "siteCopy",
    title: "Offline workbook copy",
    stage: 3,
    kind: "choice",
    when: (answers, ctx) =>
      answers.storage === "google" &&
      !!ctx.workbookReady &&
      has(answers, "focus", "field"),
    satisfied: (ctx) => (ctx.siteCopy ? "yes" : undefined),
    prompt: () => ({
      text: "Sites often have poor reception. Keep a read-only copy of your workbook on this device for site visits?",
      hint: "Choose this only on your own device: the copy contains project details.",
    }),
    options: () =>
      yesNo("Yes, this is my own device", "Not now").map((option) => ({
        ...option,
        detail: option.id === "yes" ? "Readable offline" : undefined,
      })),
    validate: (value) => oneOf({ yes: 1, no: 1 }, value, "Choose an option."),
    summary: (value) =>
      value === "yes" ? "Keep an offline copy on this device" : "Not now",
  },
  {
    id: "units",
    title: "Measurement system",
    stage: 4,
    kind: "choice",
    when: (answers) => has(answers, "focus", "field"),
    prompt: () => ({
      text: "Almost done! Which measurement system do you use on site?",
      hint: "Every reading keeps its own units. This sets the examples and defaults you see.",
    }),
    options: () => [
      {
        id: "imperial",
        label: "Imperial",
        detail: "Feet, inches and fractions",
      },
      { id: "metric", label: "Metric", detail: "Meters, centimeters, mm" },
    ],
    validate: (value) =>
      oneOf({ imperial: 1, metric: 1 }, value, "Choose a measurement system."),
    summary: (value) =>
      value === "metric"
        ? "Metric (m, cm, mm)"
        : "Imperial (feet, inches, fractions)",
  },
  {
    id: "pricingMethod",
    title: "Pricing method",
    stage: 4,
    kind: "choice",
    when: (answers) => has(answers, "focus", "requests"),
    prompt: (answers) => ({
      text: "Let’s dial in pricing for new client estimates. How do you usually price a capture job?",
      hint:
        answers.units === "metric"
          ? "Client estimates are calculated from square footage for now."
          : "You can fine-tune rates and named extras later in Account.",
    }),
    options: () => options(PRICING_CHOICES),
    validate: (value) =>
      oneOf(PRICING_CHOICES, value, "Choose how you price jobs."),
    summary: (value) => PRICING_CHOICES[value],
    dependents: ["tierStyle", "currency", "rate", "tiers", "budget"],
  },
  {
    id: "tierStyle",
    title: "How size bands apply",
    stage: 4,
    kind: "choice",
    when: (answers) => answers.pricingMethod === "tiers",
    prompt: () => ({
      text: "When a property falls in a size band, how should its rate apply?",
      hint: "Example: 8,000 sq ft at whole-property rates uses the 5,001–19,999 rate for all 8,000 sq ft.",
    }),
    options: () => [
      { id: "whole", label: TIER_STYLES.whole, detail: "Simple to explain" },
      {
        id: "progressive",
        label: TIER_STYLES.progressive,
        detail: "Like tax brackets",
      },
    ],
    validate: (value) => oneOf(TIER_STYLES, value, "Choose a tier style."),
    summary: (value) => TIER_STYLES[value],
    dependents: ["tiers"],
  },
  {
    id: "currency",
    title: "Currency",
    label: "Other currency code",
    stage: 4,
    kind: "currency",
    when: (answers) =>
      !!answers.pricingMethod && answers.pricingMethod !== "skip",
    prompt: () => ({ text: "Which currency do you bill in?" }),
    options: () => CURRENCIES.map((id) => ({ id, label: id })),
    defaultValue: (answers, ctx) => currencyForLocale(ctx.locale),
    validate: (value) =>
      validatePricing({
        ...blankPricing(),
        currency: String(value ?? "")
          .trim()
          .toUpperCase(),
      }).currency,
    summary: (value) => value,
  },
  {
    id: "rate",
    title: "Rate per square foot",
    label: "Rate per square foot",
    stage: 4,
    kind: "number",
    when: (answers) => answers.pricingMethod === "area",
    prompt: (answers) => ({
      text: `What’s your rate per square foot in ${answers.currency}?`,
      hint: "Up to four decimal places, e.g. 0.15.",
    }),
    unit: (answers) => `${answers.currency} / sq ft`,
    step: "0.01",
    defaultValue: () => blankPricing().rate,
    validate: (value) => money(value, 4),
    summary: (value, answers) => `${value} ${answers.currency} per sq ft`,
  },
  {
    id: "tiers",
    title: "Size bands",
    stage: 4,
    kind: "tiers",
    when: (answers) => ["tiers", "flat"].includes(answers.pricingMethod),
    prompt: (answers) => ({
      text:
        answers.pricingMethod === "flat"
          ? "Set a flat project fee for each property size."
          : "Set a rate per square foot for each size band.",
      hint: "Use two or three bands. The last band has no upper limit.",
    }),
    defaultValue: (answers) =>
      TIER_DEFAULTS[answers.pricingMethod === "flat" ? "flat" : "tiers"].map(
        (tier) => ({ ...tier }),
      ),
    validate: (value, answers) => {
      const flat = answers.pricingMethod === "flat";
      const tiers = validatePricing({
        ...blankPricing(),
        currency: answers.currency,
        method: flat ? "flat" : answers.tierStyle,
        tiers: value,
      }).tiers;
      tiers.forEach((tier) => money(tier.price, flat ? 2 : 4));
      return tiers;
    },
    summary: (value, answers) =>
      value.map((tier, i) => {
        const from = i ? Number(value[i - 1].upTo) + 1 : 1;
        const range = tier.upTo
          ? `${from.toLocaleString("en-US")}–${Number(tier.upTo).toLocaleString("en-US")} sq ft`
          : `${from.toLocaleString("en-US")}+ sq ft`;
        return `${range}: ${tier.price} ${answers.currency}${answers.pricingMethod === "flat" ? "" : " / sq ft"}`;
      }),
  },
  {
    id: "budget",
    title: "Client budgets",
    stage: 4,
    kind: "choice",
    when: (answers) =>
      !!answers.pricingMethod && answers.pricingMethod !== "skip",
    prompt: () => ({
      text: "Can clients suggest their own budget when they send a request?",
      hint: "With Set per client, each share link or public form asks whether that client may propose a budget.",
    }),
    options: () => [
      ...yesNo("Yes, let them propose one", "No"),
      {
        id: "per-client",
        label: "Set per client",
        detail: "Choose for each request link",
      },
    ],
    validate: (value) =>
      oneOf({ yes: 1, no: 1, "per-client": 1 }, value, "Choose an option."),
    summary: (value) =>
      value === "yes"
        ? "Clients may propose a budget"
        : value === "per-client"
          ? "Set per client"
          : "No proposed budgets",
  },
  {
    id: "logo",
    title: "Logo",
    stage: 5,
    kind: "logo",
    when: (answers) => has(answers, "focus", "requests"),
    prompt: () => ({
      text: "Want to add your logo to your client request pages?",
      hint: "PNG, JPEG or WebP up to 5 MB. It’s resized on this device first.",
    }),
    validate: (value) => {
      if (value === null) return null;
      const { logo, shape } = validateBranding({ name: "Logo", ...value });
      if (!logo) fail("Upload a logo, or skip for now.");
      return { logo, shape };
    },
    summary: (value) => (value ? "Logo added" : "No logo for now"),
  },
  {
    id: "theme",
    title: "Theme",
    stage: 5,
    kind: "choice",
    prompt: () => ({
      text: "Last touch: which look do you prefer?",
      hint: "You can switch any time from the header.",
    }),
    options: () => [
      { id: "light", label: "Light" },
      { id: "dark", label: "Dark" },
    ],
    validate: (value) => oneOf({ light: 1, dark: 1 }, value, "Choose a theme."),
    summary: (value) => (value === "dark" ? "Dark theme" : "Light theme"),
  },
  {
    id: "review",
    title: "Review",
    stage: 5,
    kind: "review",
    editable: false,
    prompt: (answers) => ({
      text: `Here’s your setup, ${answers.name}. Review anything you like, then save.`,
    }),
    validate: (value) => value === true || fail("Review and save your setup."),
    summary: () => "Saved my setup",
  },
];
const byId = new Map(STEPS.map((step) => [step.id, step]));
export const stepById = (id) => byId.get(id);

export const newSetup = (now = new Date().toISOString()) => ({
  version: 1,
  status: "active",
  answers: {},
  done: [],
  startedAt: now,
  updatedAt: now,
});
function validState(value) {
  return (
    value?.version === 1 &&
    ["active", "complete"].includes(value.status) &&
    value.answers &&
    typeof value.answers === "object" &&
    !Array.isArray(value.answers) &&
    Array.isArray(value.done) &&
    value.done.every((id) => byId.has(id))
  );
}
export function readSetup(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(SETUP_KEY) || "null");
    return validState(value) ? value : null;
  } catch {
    return null;
  }
}
export function writeSetup(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(SETUP_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
export const setupStatus = (state = readSetup()) => state?.status || "none";

// Walk the ordered steps. Action steps (Google, workbook) count as done only
// while the live connection confirms them. A done step whose stored answer no
// longer validates (for example after an option list changed) is asked again.
// Stored answers are re-checked without runtime limits such as being offline.
export function walk(state, ctx = {}) {
  const answers = {},
    history = [];
  for (const step of STEPS) {
    if (step.when && !step.when(answers, ctx)) continue;
    const automatic = step.satisfied?.(ctx, state.answers[step.id]);
    if (automatic !== undefined) {
      answers[step.id] = automatic;
      history.push({ step, value: automatic, automatic: true });
      continue;
    }
    if (state.done.includes(step.id) && !step.action) {
      try {
        const value = step.validate(state.answers[step.id], answers, {});
        answers[step.id] = value;
        history.push({ step, value });
        continue;
      } catch {
        /* ask again below */
      }
    }
    return { answers, history, current: step };
  }
  return { answers, history, current: null };
}
export function suggestedValue(state, step, answers, ctx = {}) {
  if (Object.hasOwn(state.answers, step.id)) return state.answers[step.id];
  return step.defaultValue?.(answers, ctx);
}
function withoutDependents(done, id) {
  const remove = new Set();
  const queue = [...(byId.get(id)?.dependents || [])];
  while (queue.length) {
    const next = queue.shift();
    if (remove.has(next)) continue;
    remove.add(next);
    queue.push(...(byId.get(next)?.dependents || []));
  }
  return done.filter((item) => !remove.has(item));
}
export function answerStep(state, id, value, ctx = {}, now) {
  const step = byId.get(id);
  const { answers, current } = walk(state, ctx);
  if (!step || current?.id !== id)
    throw new Error("This question changed. Review the current question.");
  const clean = step.validate(value, answers, ctx);
  const changed =
    JSON.stringify(state.answers[id]) !== JSON.stringify(clean) &&
    Object.hasOwn(state.answers, id);
  const done = changed ? withoutDependents(state.done, id) : state.done;
  return {
    ...state,
    status: id === "review" ? "complete" : "active",
    answers: { ...state.answers, [id]: clean },
    done: [...done.filter((item) => item !== id), id],
    updatedAt: now || new Date().toISOString(),
    ...(id === "review"
      ? { completedAt: now || new Date().toISOString() }
      : {}),
  };
}
export function editStep(state, id, now) {
  return {
    ...state,
    status: "active",
    done: state.done.filter((item) => item !== id && item !== "review"),
    updatedAt: now || new Date().toISOString(),
  };
}
// Reopen a finished setup on its review card so any answer can be revised.
export const reopenSetup = (state, now) => editStep(state, "review", now);

export function stageProgress(walked) {
  const stage = walked.current ? walked.current.stage : STAGES.length;
  return {
    stage: Math.min(stage, STAGES.length - 1),
    label: walked.current ? STAGES[walked.current.stage] : "All set",
    percent: walked.current
      ? Math.round((walked.current.stage / STAGES.length) * 100)
      : 100,
  };
}

// The stored answers as one provider profile for the rest of the app. Only
// answers that still apply (by their branching) are included.
export function setupProfile(state = readSetup()) {
  if (!state) return null;
  const a = state.answers;
  const applies = (id) => {
    const step = byId.get(id);
    return Object.hasOwn(a, id) && (!step.when || step.when(a, {}) !== false);
  };
  const tourHosts = applies("tourHosting") ? a.tourHosting : [];
  let pricing = null;
  try {
    pricing = applies("pricingMethod") ? pricingConfig(a) : null;
  } catch {
    pricing = null;
  }
  const deliverables = applies("deliverables")
    ? labels(deliverableOptions(a), a.deliverables).map((label) =>
        label === "360° virtual tour link" && tourHosts?.length
          ? `${label} (${labels(TOUR_HOSTS, tourHosts).join(", ")})`
          : label,
      )
    : [];
  return {
    complete: state.status === "complete",
    name: a.name || "",
    business: a.business || "",
    email: a.contact?.email || "",
    phone: a.contact?.phone || "",
    area: a.contact?.area || "",
    website: a.contact?.website || "",
    focus: labels(FOCUS, a.focus),
    hardware: [
      ...labels(HARDWARE, a.hardware).filter((h) => h !== "Other / custom"),
      ...(applies("hardwareOther") ? [a.hardwareOther] : []),
    ],
    deliverables,
    tourHosts: labels(TOUR_HOSTS, tourHosts),
    storage: a.storage || "",
    units: applies("units") ? a.units : "",
    pricing,
    logo: applies("logo") ? a.logo : null,
    theme: a.theme || "",
  };
}
export function providerDefaults(profile = setupProfile()) {
  if (!profile) return {};
  return Object.fromEntries(
    [
      ["providerName", profile.business],
      ["providerEmail", profile.email],
    ].filter(([, value]) => value),
  );
}
export function brandingSuggestion(profile = setupProfile()) {
  if (!profile?.business) return null;
  return {
    name: profile.business,
    website: profile.website,
    phone: profile.phone,
    area: profile.area,
    logo: profile.logo?.logo || "",
    shape: profile.logo?.shape || "rounded",
  };
}
