import { fetchRead } from "./network.js";
const localGoogleConfig = () => ({
  clientId: import.meta.env?.VITE_GOOGLE_CLIENT_ID || "",
  apiKey: import.meta.env?.VITE_GOOGLE_PICKER_API_KEY || "",
  appId: import.meta.env?.VITE_GOOGLE_PROJECT_NUMBER || "",
  persistentEnabled: false,
});
// Public browser configuration only: the OAuth client ID, the restricted
// Picker key and the project number. No secret is ever returned here.
export async function loadGoogleConfig(signal) {
  try {
    const response = await fetchRead("/api/google-config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error("Google settings unavailable");
    const config = await response.json();
    if (
      !config ||
      typeof config !== "object" ||
      typeof config.clientId !== "string" ||
      typeof config.apiKey !== "string" ||
      typeof config.appId !== "string"
    )
      throw new Error("Google settings response was invalid");
    return {
      clientId: config.clientId,
      apiKey: config.apiKey,
      appId: config.appId,
      persistentEnabled: config.persistentEnabled === true,
    };
  } catch (error) {
    // Vite dev has no Pages Function, so local QA can use .env.local.
    if (import.meta.env?.DEV && !signal?.aborted) return localGoogleConfig();
    throw error;
  }
}
