export class CoordinationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const stableJSON = (v) =>
  JSON.stringify(v, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value,
  );
