export const LOGO_LIMIT = 80000;
export const emptyBranding = () => ({
  name: "",
  website: "",
  logo: "",
  shape: "rounded",
});
export function validateBranding(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Enter your business details.");
  const { name, website = "", logo = "", shape = "rounded" } = input;
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
  return { name: name.trim(), website: address, logo, shape };
}
