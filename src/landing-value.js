const STANDARD_PRICE = 39.95;
const LAUNCH_PRICE = 29.96;

function positiveNumber(value, maximum) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum
    ? number
    : null;
}

function jobsToCover(price, value) {
  const ratio = price / value;
  // Absorb floating-point noise at an exact whole-job boundary.
  return Math.ceil(ratio - Number.EPSILON * Math.max(1, ratio) * 4);
}

/** Illustrative time value, not a claim about actual customer savings. */
export function estimateTimeValue(minutes, hourlyRate) {
  const time = positiveNumber(minutes, 480);
  const rate = positiveNumber(hourlyRate, 10000);
  if (time === null || rate === null) return null;
  const perJob = (time / 60) * rate;
  if (!Number.isFinite(perJob) || perJob <= 0) return null;
  const standardJobs = jobsToCover(STANDARD_PRICE, perJob);
  const launchJobs = jobsToCover(LAUNCH_PRICE, perJob);
  if (
    ![standardJobs, launchJobs].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    return null;
  return {
    perJob,
    standardJobs,
    launchJobs,
    standardProgress: Math.min(1, perJob / STANDARD_PRICE),
    launchProgress: Math.min(1, perJob / LAUNCH_PRICE),
  };
}
