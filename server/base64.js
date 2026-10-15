import { Buffer } from "node:buffer";

// Node compatibility is already enabled in Pages. Native conversion avoids
// per-byte JavaScript work for bounded uploads and encrypted archives.
export const base64url = (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64url",
  );

// Retain atob's strict validation: Buffer's base64 decoder alone is permissive.
export const base64Bytes = (text) => Buffer.from(atob(text), "latin1");
export const base64urlBytes = (text) =>
  base64Bytes(text.replaceAll("-", "+").replaceAll("_", "/"));
