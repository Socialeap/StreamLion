export const LOGO_LIMIT = 80000;
export const emptyBranding = () => ({
  name: "",
  website: "",
  logo: "",
  shape: "rounded",
});
// Optional public contact details. Digits, spaces, +, ( ) . and - only.
export function brandingPhone(value = "") {
  if (typeof value !== "string")
    throw new Error("Use digits, spaces, +, ( ) or - with 7 to 15 digits.");
  const phone = value.replace(/\s+/g, " ").trim();
  const digits = phone.replace(/\D/g, "").length;
  if (
    phone &&
    (phone.length > 40 ||
      !/^\+?[\d\s().-]+$/.test(phone) ||
      digits < 7 ||
      digits > 15)
  )
    throw new Error("Use digits, spaces, +, ( ) or - with 7 to 15 digits.");
  return phone;
}
export function formatPhone(value) {
  const digits = value.replace(/\D/g, "");
  // Only plain ten-digit or +1 numbers are reformatted; others keep their form.
  if (/^[\d\s().-]+$/.test(value) && digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (/^\+1[\d\s().-]+$/.test(value) && digits.length === 11)
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value;
}
export function brandingArea(value = "") {
  const area =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null;
  if (area === null || area.length > 200 || /[\x00-\x1f\x7f]/.test(area))
    throw new Error("Keep the service area under 200 characters.");
  return area;
}
// Optional first line of the client request assistant, in the provider's words.
export const WELCOME_LIMIT = 280;
export function brandingWelcome(value = "") {
  const text =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null;
  if (
    text === null ||
    text.length > WELCOME_LIMIT ||
    /[\x00-\x1f\x7f]/.test(text)
  )
    throw new Error(`Keep the welcome line under ${WELCOME_LIMIT} characters.`);
  return text;
}
export function validateBranding(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Enter your business details.");
  const {
    name,
    website = "",
    logo = "",
    shape = "rounded",
    phone = "",
    area = "",
    welcome = "",
  } = input;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 100 ||
    /[\x00-\x1f\x7f]/.test(name)
  )
    throw new Error("Enter a business name of up to 100 characters.");
  if (typeof website !== "string" || website.length > 500)
    throw new Error("Enter a valid HTTPS website address.");
  let address = "";
  if (website.trim()) {
    let url;
    try {
      url = new URL(website.trim());
    } catch {
      throw new Error("Use a full website address starting with https://.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      /[\x00-\x20\x7f]/.test(website.trim())
    )
      throw new Error("Use a public HTTPS website address without passwords.");
    address = url.href;
  }
  if (!["rounded", "square", "rectangle"].includes(shape))
    throw new Error("Choose a logo shape.");
  if (typeof logo !== "string")
    throw new Error("Upload a PNG, JPEG or WebP logo.");
  if (logo) {
    if (
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(logo) ||
      logo.length > Math.ceil(LOGO_LIMIT / 3) * 4 + 22
    )
      throw new Error("Logo is too large or invalid. Upload it again.");
    let bytes;
    try {
      bytes = atob(logo.split(",")[1]);
    } catch {
      throw new Error("Invalid logo image.");
    }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length < 45 ||
      bytes.length > LOGO_LIMIT ||
      signature.some((v, i) => bytes.charCodeAt(i) !== v) ||
      bytes.slice(12, 16) !== "IHDR" ||
      bytes.slice(-8, -4) !== "IEND"
    )
      throw new Error("Upload a valid PNG logo.");
    // Read only the eight dimension bytes; avoid per-byte JS work on the full upload.
    const view = new DataView(
      Uint8Array.from(bytes.slice(16, 24), (c) => c.charCodeAt(0)).buffer,
    );
    const w = view.getUint32(0),
      h = view.getUint32(4);
    if (!w || !h || w > 640 || h > 640)
      throw new Error("Logo dimensions exceed 640 pixels. Upload it again.");
  }
  const contact = {
    phone: brandingPhone(phone),
    area: brandingArea(area),
    welcome: brandingWelcome(welcome),
  };
  // Saved profiles without these optional details keep their original shape.
  return {
    name: name.trim(),
    website: address,
    logo,
    shape,
    ...Object.fromEntries(Object.entries(contact).filter(([, v]) => v)),
  };
}
