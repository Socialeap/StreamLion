const STANDARD_PRICE = 39.95;
const LAUNCH_PRICE = 29.96;

export const VALUE_TASKS = ["brief", "readings", "handover"];

/** Only a valid live quote with available slots may reveal promotional pricing. */
export function confirmedPurchaseQuote(config) {
  if (
    !config?.enabled ||
    config.mode !== "live" ||
    ![config.amount, config.standardAmount].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    config.currency !== "usd" ||
    ![7, 14, 30].includes(config.refundDays) ||
    (config.amount < config.standardAmount &&
      (!Number.isSafeInteger(config.launchRemaining) ||
        config.launchRemaining <= 0))
  )
    return null;
  return config;
}

/** Editable task timings are planning assumptions, not measured app performance. */
export function estimateTaskValue(tasks, hourlyRate, prices) {
  if (!Array.isArray(tasks) || tasks.length !== VALUE_TASKS.length) return null;
  const rate = positiveNumber(hourlyRate, 10000);
  if (rate === null) return null;
  let before = 0,
    after = 0;
  for (const task of tasks) {
    for (const key of ["before", "after"]) {
      const value = task?.[key];
      if (
        (typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && !value.trim())
      )
        return null;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 480) return null;
      if (key === "before") before += number;
      else after += number;
    }
  }
  if (before > 480 || after > 480) return null;
  const minutes = before - after;
  return {
    before,
    after,
    minutes,
    value: minutes > 0 ? estimateTimeValue(minutes, rate, prices) : null,
  };
}

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
export function estimateTimeValue(
  minutes,
  hourlyRate,
  { standard = STANDARD_PRICE, launch = LAUNCH_PRICE } = {},
) {
  standard = positiveNumber(standard, 10000);
  launch = positiveNumber(launch, 10000);
  if (standard === null || launch === null) return null;
  const time = positiveNumber(minutes, 480);
  const rate = positiveNumber(hourlyRate, 10000);
  if (time === null || rate === null) return null;
  const perJob = (time / 60) * rate;
  if (!Number.isFinite(perJob) || perJob <= 0) return null;
  const standardJobs = jobsToCover(standard, perJob);
  const launchJobs = jobsToCover(launch, perJob);
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
    standardProgress: Math.min(1, perJob / standard),
    launchProgress: Math.min(1, perJob / launch),
  };
}
