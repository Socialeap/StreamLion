export class CoordinationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const stableJSON = (v) =>
  JSON.stringify(v, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? sortedRecord(value)
      : value,
  );

function sortedRecord(value) {
  // A null prototype also preserves own "__proto__" keys as ordinary data.
  // Avoid an intermediate entry array and a two-element array per property.
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return sorted;
}
