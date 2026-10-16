// The provider's public phone and service area, kept on this device so a
// handover can be prepared offline. Saved or loaded branding refreshes it;
// before that, the setup assistant's answers are used.
import { brandingArea, brandingPhone } from "./provider-branding.js";
import { setupProfile } from "./setup-assistant.js";

export const PROVIDER_CONTACT_KEY = "streamlion-provider-contact-v1";
function clean(value) {
  try {
    return {
      phone: brandingPhone(value?.phone || ""),
      area: brandingArea(value?.area || ""),
    };
  } catch {
    return null;
  }
}
// Reads stored card text, e.g. from a device backup; null when invalid.
export function parseProviderContact(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? clean(value) : null;
  } catch {
    return null;
  }
}
export function rememberProviderContact(value) {
  const contact = clean(value);
  if (!contact) return false;
  try {
    localStorage.setItem(PROVIDER_CONTACT_KEY, JSON.stringify(contact));
    return true;
  } catch {
    return false;
  }
}
export function providerContact() {
  let saved = null;
  try {
    const raw = localStorage.getItem(PROVIDER_CONTACT_KEY);
    saved = raw && clean(JSON.parse(raw));
  } catch {
    /* fall back to the setup answers */
  }
  return saved || clean(setupProfile()) || { phone: "", area: "" };
}
