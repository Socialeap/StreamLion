const DAY = 86400000;
const one = (env, q, ...v) =>
  env.GOOGLE_SESSIONS.prepare(q)
    .bind(...v)
    .first();
const error = (status, message) =>
  Object.assign(new Error(message), { status });
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const futureWindow = (p, at) =>
  Number.isSafeInteger(at) &&
  p.application_start <= at &&
  at < p.application_end &&
  at + p.duration_days * DAY < p.closes_at;
export async function readPilotPolicy(
  env,
  mode,
  now = Date.now(),
  materialize = true,
) {
  let p = await one(
    env,
    "SELECT p.* FROM streamlion_free_pilot_policy_v1 p JOIN streamlion_free_pilot_schema_v1 s ON s.version=1 WHERE p.mode=?",
    mode,
  );
  if (!p) throw error(503, "Pilot configuration is unavailable.");
  if (p.admission_mode === undefined)
    return {
      ...p,
      admission_mode: "manual",
      controlsAvailable: false,
      reopen_at: null,
      reopen_slots: 0,
    };
  const stamp = await one(
    env,
    "SELECT version FROM streamlion_free_pilot_instant_schema_v1 WHERE version=1",
  );
  if (
    !stamp ||
    !["manual", "instant"].includes(p.admission_mode) ||
    !integer(p.revision, 0, Number.MAX_SAFE_INTEGER) ||
    !integer(p.reopen_slots, 0, 20) ||
    (p.reopen_at === null
      ? p.reopen_slots !== 0
      : !integer(p.reopen_at, 1, Number.MAX_SAFE_INTEGER) ||
        p.reopen_slots === 0) ||
    p.admission_cap + p.reopen_slots > 20
  )
    throw error(503, "Pilot controls are unavailable.");
  if (
    materialize &&
    p.admissions_open === 1 &&
    p.reopen_at !== null &&
    p.reopen_at <= now &&
    futureWindow(p, now)
  ) {
    await one(
      env,
      "UPDATE streamlion_free_pilot_policy_v1 SET admission_cap=admission_cap+reopen_slots,reopen_at=NULL,reopen_slots=0,revision=revision+1,updated_at=?,updated_by='schedule',update_reason='Scheduled release of additional pilot places' WHERE mode=? AND revision=? AND admissions_open=1 AND reopen_at<=? AND reopen_slots>0 AND admission_cap+reopen_slots<=20 AND application_start<=? AND application_end>? AND closes_at>?+duration_days*86400000 RETURNING mode",
      now,
      mode,
      p.revision,
      now,
      now,
      now,
      now,
    );
    p = await one(
      env,
      "SELECT * FROM streamlion_free_pilot_policy_v1 WHERE mode=?",
      mode,
    );
  }
  return { ...p, controlsAvailable: true };
}
export async function updatePilotPolicy(
  env,
  mode,
  actor,
  route,
  b,
  p,
  now = Date.now(),
) {
  if (!p.controlsAvailable)
    throw error(503, "Pilot controls require the reviewed migration.");
  if (
    !integer(b.revision, 0, Number.MAX_SAFE_INTEGER) ||
    b.revision !== p.revision
  )
    throw error(
      409,
      "Pilot settings changed. Reload the controls before saving.",
    );
  if (
    typeof b.reason !== "string" ||
    !b.reason.trim() ||
    b.reason.trim().length > 500
  )
    throw error(400, "Enter a short reason for this change.");
  let sql, values;
  const reason = b.reason.trim();
  if (route === "admin/settings") {
    const {
      activeCap,
      admissionCap,
      durationDays,
      applicationStart,
      applicationEnd,
      closesAt,
      interestOpen,
      admissionsOpen,
      admissionMode,
    } = b;
    if (
      !integer(activeCap, 1, 20) ||
      !integer(admissionCap, activeCap, 20) ||
      ![7, 14].includes(durationDays) ||
      typeof interestOpen !== "boolean" ||
      typeof admissionsOpen !== "boolean" ||
      !["manual", "instant"].includes(admissionMode) ||
      ![applicationStart, applicationEnd, closesAt].every((n) =>
        integer(n, 1, Number.MAX_SAFE_INTEGER),
      ) ||
      !(applicationStart < applicationEnd && applicationEnd < closesAt) ||
      applicationEnd <= now ||
      applicationEnd + durationDays * DAY > closesAt ||
      !futureWindow(
        {
          application_start: applicationStart,
          application_end: applicationEnd,
          closes_at: closesAt,
          duration_days: durationDays,
        },
        Math.max(now, applicationStart),
      )
    )
      throw error(
        400,
        "Check participant limits, trial duration and UTC dates.",
      );
    const admitted = await one(
      env,
      "SELECT COUNT(*) AS n FROM streamlion_free_pilot_accounts_v1 WHERE mode=? AND admitted_at IS NOT NULL",
      mode,
    );
    if (
      admissionCap < admitted.n ||
      admissionCap + (admissionsOpen ? p.reopen_slots : 0) > 20
    )
      throw error(
        400,
        "Total admissions cannot be reduced below history or exceed 20 with the scheduled release.",
      );
    if (
      admissionsOpen &&
      p.reopen_at !== null &&
      (p.reopen_at <= now ||
        !futureWindow(
          {
            application_start: applicationStart,
            application_end: applicationEnd,
            closes_at: closesAt,
            duration_days: durationDays,
          },
          Math.max(now, p.reopen_at),
        ))
    )
      throw error(
        400,
        "Cancel or change the scheduled opening before changing these dates.",
      );
    sql =
      "UPDATE streamlion_free_pilot_policy_v1 SET active_cap=?,admission_cap=?,duration_days=?,application_start=?,application_end=?,closes_at=?,interest_open=?,admissions_open=?,admission_mode=?,reopen_at=CASE WHEN ?=0 THEN NULL ELSE reopen_at END,reopen_slots=CASE WHEN ?=0 THEN 0 ELSE reopen_slots END,revision=revision+1,updated_at=?,updated_by=?,update_reason=? WHERE mode=? AND revision=? AND ? >= (SELECT COUNT(*) FROM streamlion_free_pilot_accounts_v1 WHERE mode=? AND admitted_at IS NOT NULL) AND ?+CASE WHEN ?=0 THEN 0 ELSE reopen_slots END<=20 RETURNING mode";
    values = [
      activeCap,
      admissionCap,
      durationDays,
      applicationStart,
      applicationEnd,
      closesAt,
      +interestOpen,
      +admissionsOpen,
      admissionMode,
      +admissionsOpen,
      +admissionsOpen,
      now,
      actor,
      reason,
      mode,
      b.revision,
      admissionCap,
      mode,
      admissionCap,
      +admissionsOpen,
    ];
  } else if (route === "admin/schedule") {
    if (
      !integer(b.slots, 1, 20) ||
      !integer(b.reopenAt, now + 1, Number.MAX_SAFE_INTEGER) ||
      !futureWindow(p, b.reopenAt) ||
      p.admission_cap + b.slots > 20 ||
      p.admissions_open !== 1
    )
      throw error(
        400,
        "Choose 1–20 additional places and a future UTC date within the open pilot window, up to 20 total admissions.",
      );
    sql =
      "UPDATE streamlion_free_pilot_policy_v1 SET reopen_at=?,reopen_slots=?,revision=revision+1,updated_at=?,updated_by=?,update_reason=? WHERE mode=? AND revision=? AND admissions_open=1 AND admission_cap+?<=20 AND application_start<=? AND application_end>? AND closes_at>?+duration_days*86400000 RETURNING mode";
    values = [
      b.reopenAt,
      b.slots,
      now,
      actor,
      reason,
      mode,
      b.revision,
      b.slots,
      b.reopenAt,
      b.reopenAt,
      b.reopenAt,
    ];
  } else if (route === "admin/pause" || route === "admin/cancel-schedule") {
    sql = `UPDATE streamlion_free_pilot_policy_v1 SET ${route === "admin/pause" ? "admissions_open=0," : ""}reopen_at=NULL,reopen_slots=0,revision=revision+1,updated_at=?,updated_by=?,update_reason=? WHERE mode=? AND revision=? RETURNING mode`;
    values = [now, actor, reason, mode, b.revision];
  } else throw error(404, "Not found.");
  if (!(await one(env, sql, ...values)))
    throw error(
      409,
      "Pilot settings changed. Reload the controls before saving.",
    );
  return { updated: true };
}
