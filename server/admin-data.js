// google-auth imports this module for account observation. Most requests do
// not use reporting dates, so avoid paying Intl's native initialization cost
// on every cold health, scheduler or authentication isolate.
let zone;
function reportingZone() {
  return (zone ||= new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }));
}
export const CREDIT_UNIT = 12500;
export const OWNER_EMAIL = "shakoure@transcendencemedia.com";
// Keep displayed identity and prefix search on the same mode-scoped sources.
const effectiveName = "COALESCE(NULLIF(u.name,''),p.name,'')";
const effectiveBusiness =
  "CASE WHEN json_type(b.profile,'$.name')='text' THEN json_extract(b.profile,'$.name') ELSE COALESCE(p.business,'') END";
const identityJoins = `LEFT JOIN streamlion_free_pilot_accounts_v1 p ON p.mode=a.mode AND p.google_subject=u.google_subject
 LEFT JOIN streamlion_provider_branding_v1 b ON b.mode=a.mode AND b.google_subject=u.google_subject`;

export async function adminInstalled(db) {
  if (
    !db ||
    !(await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='streamlion_admin_schema_v1'",
      )
      .first())
  )
    return false;
  return (
    (
      await db
        .prepare(
          "SELECT version FROM streamlion_admin_schema_v1 WHERE version=1",
        )
        .first()
    )?.version === 1
  );
}
export function localDate(time) {
  const p = Object.fromEntries(
    reportingZone()
      .formatToParts(new Date(time))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function calendarDays(now, count) {
  const day = localDate(now),
    n = Date.parse(day + "T12:00:00Z");
  return Array.from({ length: count }, (_, i) =>
    new Date(n - (count - 1 - i) * 86400000).toISOString().slice(0, 10),
  );
}
export function localStart(day) {
  let low = Date.parse(day + "T00:00:00Z") - 86400000,
    high = low + 172800000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDate(mid) < day) low = mid + 1;
    else high = mid;
  }
  return low;
}
export async function observeAccount(
  db,
  identity,
  mode,
  now = Date.now(),
  { historical = false, source = "verified_signin" } = {},
) {
  if (!["test", "live"].includes(mode) || !(await adminInstalled(db))) return;
  const subject = identity.sub || identity.google_subject,
    email = identity.email || "";
  if (!subject) return;
  await db
    .prepare(
      "INSERT INTO streamlion_accounts_v1(google_subject,email,first_known_at,signup_at,last_signin_at,first_known_source) VALUES(?,?,?,?,?,?) ON CONFLICT(google_subject) DO UPDATE SET email=CASE WHEN excluded.email!='' THEN excluded.email ELSE email END,last_signin_at=MAX(COALESCE(last_signin_at,0),COALESCE(excluded.last_signin_at,0))",
    )
    .bind(
      subject,
      email,
      now,
      historical ? null : now,
      historical ? null : now,
      source,
    )
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO streamlion_account_activity_v1 VALUES(?,?,0)",
    )
    .bind(mode, subject)
    .run();
}
export async function observeActivity(
  db,
  mode,
  subject,
  occurred = Date.now(),
  received = Date.now(),
) {
  if (!["test", "live"].includes(mode) || !(await adminInstalled(db))) return;
  if (
    !Number.isSafeInteger(occurred) ||
    occurred > received + 30000 ||
    occurred < received - 7 * 86400000
  )
    return;
  const date = localDate(occurred);
  await db.batch([
    db
      .prepare(
        "INSERT INTO streamlion_account_activity_v1 VALUES(?,?,?) ON CONFLICT(mode,google_subject) DO UPDATE SET last_active_at=MAX(last_active_at,excluded.last_active_at)",
      )
      .bind(mode, subject, occurred),
    db
      .prepare(
        "INSERT INTO streamlion_account_days_v1 VALUES(?,?,?,?,?) ON CONFLICT(mode,google_subject,reporting_date) DO UPDATE SET last_received_at=MAX(last_received_at,excluded.last_received_at)",
      )
      .bind(mode, subject, date, received, received),
    db
      .prepare(
        "DELETE FROM streamlion_account_days_v1 WHERE rowid IN (SELECT rowid FROM streamlion_account_days_v1 WHERE reporting_date<? LIMIT 100)",
      )
      .bind(calendarDays(received, 91)[0]),
  ]);
}
const rows = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;
export async function allowance(db, mode, now) {
  const month = localDate(now).slice(0, 7);
  const p = await db
    .prepare("SELECT * FROM streamlion_admin_policy_v1 WHERE mode=?")
    .bind(mode)
    .first();
  const used = await db
    .prepare(
      "SELECT COALESCE(SUM(amount_micros),0) n FROM streamlion_admin_grants_v1 WHERE mode=? AND month=?",
    )
    .bind(mode, month)
    .first();
  return {
    perGrant: p.per_grant_micros / CREDIT_UNIT,
    perAccountMonth: p.account_month_micros / CREDIT_UNIT,
    monthly: p.month_micros / CREDIT_UNIT,
    remaining: Math.max(0, p.month_micros - used.n) / CREDIT_UNIT,
    month,
    grantsEnabled: p.grants_enabled === 1,
  };
}
export async function walletReport(db, mode, subject) {
  const p = await db
    .prepare(
      "SELECT balance_micros n FROM streamlion_credit_wallets_v1 WHERE mode=? AND google_subject=?",
    )
    .bind(mode, subject)
    .first();
  const s = await db
    .prepare(
      "SELECT balance_micros n FROM streamlion_promotional_wallets_v1 WHERE mode=? AND google_subject=?",
    )
    .bind(mode, subject)
    .first();
  const g = await db
    .prepare(
      "SELECT balance_micros n FROM streamlion_goodwill_available_v1 WHERE mode=? AND google_subject=?",
    )
    .bind(mode, subject)
    .first();
  return {
    purchased: (p?.n || 0) / CREDIT_UNIT,
    starter: (s?.n || 0) / CREDIT_UNIT,
    goodwill: (g?.n || 0) / CREDIT_UNIT,
    hold: (p?.n || 0) < 0,
    available:
      (p?.n || 0) < 0
        ? 0
        : ((p?.n || 0) + (s?.n || 0) + (g?.n || 0)) / CREDIT_UNIT,
  };
}
export async function usageReport(db, mode, subject, from, to) {
  const args = [mode, subject, from, to];
  const v = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN state='complete' THEN amount ELSE 0 END),0) used,COALESCE(SUM(CASE WHEN state='reserved' THEN amount ELSE 0 END),0) reserved FROM (SELECT amount,state FROM streamlion_shared_spends_v1 WHERE mode=? AND google_subject=? AND created_at>=? AND created_at<=? UNION ALL SELECT price_micros,state FROM streamlion_speech_turns_v1 WHERE mode=? AND google_subject=? AND created_at>=? AND created_at<=?)`,
    )
    .bind(...args, ...args)
    .first();
  return { used: v.used / CREDIT_UNIT, reserved: v.reserved / CREDIT_UNIT };
}
async function hydratePage(db, page, mode, now, days) {
  if (!page.length) return [];
  const sql = `WITH q AS(SELECT ? mode,? at,? day7,? day30,? from_at,? month)
 SELECT u.google_subject,u.email,${effectiveName} name,${effectiveBusiness} business,u.first_known_at,u.signup_at,a.last_active_at,
 COALESCE(w.balance_micros,0) cash,COALESCE(s.balance_micros,0) starter,COALESCE((SELECT SUM(gb.remaining_micros) FROM streamlion_admin_grants_v1 gg JOIN streamlion_admin_grant_balances_v1 gb ON gb.grant_id=gg.id WHERE gg.mode=q.mode AND gg.google_subject=u.google_subject),0) goodwill,
 EXISTS(SELECT 1 FROM streamlion_purchases_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.status='paid') core_paid,
 EXISTS(SELECT 1 FROM streamlion_purchases_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.status='disputed') disputed,
 EXISTS(SELECT 1 FROM streamlion_purchases_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.status='refunded') refunded,
 (SELECT MIN(created_at) FROM streamlion_purchases_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject) first_order,
 (SELECT MIN(t.paid_at) FROM streamlion_admin_payment_times_v1 t JOIN streamlion_purchases_v1 c ON c.order_id=t.order_id WHERE t.kind='core' AND c.mode=q.mode AND c.google_subject=u.google_subject) confirmed,
 p.state pilot_state,p.ends_at pilot_end,
 (SELECT COUNT(*) FROM streamlion_account_days_v1 d WHERE d.mode=q.mode AND d.google_subject=u.google_subject AND d.reporting_date>=q.day7 AND d.reporting_date<=?) active7,
 (SELECT COUNT(*) FROM streamlion_account_days_v1 d WHERE d.mode=q.mode AND d.google_subject=u.google_subject AND d.reporting_date>=q.day30 AND d.reporting_date<=?) active30,
 COALESCE((SELECT SUM(credited_micros) FROM streamlion_credit_orders_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject),0) bought,
 COALESCE((SELECT SUM(amount_micros) FROM streamlion_admin_grants_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject),0) granted,
 COALESCE((SELECT SUM(amount_micros) FROM streamlion_admin_grants_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.month=q.month),0) month_granted,
 COALESCE((SELECT SUM(amount) FROM streamlion_shared_spends_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.state='complete' AND c.created_at>=q.from_at AND c.created_at<=q.at),0)+COALESCE((SELECT SUM(price_micros) FROM streamlion_speech_turns_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.state='complete' AND c.created_at>=q.from_at AND c.created_at<=q.at),0) used,
 COALESCE((SELECT SUM(amount) FROM streamlion_shared_spends_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.state='reserved'),0)+COALESCE((SELECT SUM(price_micros) FROM streamlion_speech_turns_v1 c WHERE c.mode=q.mode AND c.google_subject=u.google_subject AND c.state='reserved'),0) reserved
 FROM q JOIN streamlion_account_activity_v1 a ON a.mode=q.mode JOIN streamlion_accounts_v1 u USING(google_subject)
 LEFT JOIN streamlion_credit_wallets_v1 w ON w.mode=q.mode AND w.google_subject=u.google_subject
 LEFT JOIN streamlion_promotional_wallets_v1 s ON s.mode=q.mode AND s.google_subject=u.google_subject
 ${identityJoins}
 WHERE u.google_subject IN (${page.map(() => "?").join(",")})`;
  const data = await rows(
    db,
    sql,
    mode,
    now,
    calendarDays(now, 7)[0],
    calendarDays(now, 30)[0],
    localStart(calendarDays(now, days)[0]),
    localDate(now).slice(0, 7),
    localDate(now),
    localDate(now),
    ...page.map((x) => x.google_subject),
  );
  const mapped = new Map(
    data.map((r) => {
      const hold = r.cash < 0,
        status = hold
          ? "credit_hold"
          : r.core_paid
            ? "paid"
            : r.pilot_state === "active" && r.pilot_end > now
              ? "pilot_active"
              : r.disputed
                ? "disputed"
                : r.refunded
                  ? "refunded"
                  : r.pilot_state
                    ? "pilot_" +
                      (r.pilot_state === "active" ? "expired" : r.pilot_state)
                    : "registered";
      return [
        r.google_subject,
        {
          subject: r.google_subject,
          email: r.email,
          name: r.name,
          business: r.business,
          firstKnownAt: r.first_known_at,
          signupAt: r.signup_at,
          lastActiveAt: r.last_active_at || 0,
          status,
          paidAt: r.confirmed || null,
          orderCreatedAt: r.first_order || null,
          paymentDateBasis: r.confirmed
            ? "first_confirmation"
            : "order_creation_only",
          active7: r.active7,
          active30: r.active30,
          netPurchasedCredits: r.bought / CREDIT_UNIT,
          grantedCredits: r.granted / CREDIT_UNIT,
          grantedThisMonth: r.month_granted / CREDIT_UNIT,
          creditsUsed: r.used / CREDIT_UNIT,
          reservedCredits: r.reserved / CREDIT_UNIT,
          wallet: {
            purchased: r.cash / CREDIT_UNIT,
            starter: r.starter / CREDIT_UNIT,
            goodwill: r.goodwill / CREDIT_UNIT,
            hold,
            available:
              hold || !r.core_paid
                ? 0
                : (r.cash + r.starter + r.goodwill) / CREDIT_UNIT,
          },
          canGrant: status === "paid",
        },
      ];
    }),
  );
  return page.map((p) => mapped.get(p.google_subject));
}
export async function listUsers(db, mode, params, now) {
  const days = [7, 30, 90].includes(Number(params.get("days")))
    ? Number(params.get("days"))
    : 30;
  const limit = params.get("limit") === "50" ? 50 : 25;
  const search = (params.get("search") || "").trim().toLowerCase();
  if (search.length > 120)
    throw Object.assign(Error("Search is too long."), { status: 400 });
  const searchJoins = search ? identityJoins : "";
  const filter = params.get("filter") || "all";
  if (!["all", "paid", "pilot", "active", "inactive", "low"].includes(filter))
    throw Object.assign(Error("Invalid filter."), { status: 400 });
  const oldest = params.get("sort") === "oldest",
    direction = oldest ? "ASC" : "DESC",
    args = [mode];
  let where =
    "a.mode=? AND NOT EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 o WHERE o.mode=a.mode AND o.google_subject=a.google_subject)";
  if (search) {
    where += ` AND (u.email LIKE ? ESCAPE '\\' COLLATE NOCASE OR (${effectiveName}) LIKE ? ESCAPE '\\' COLLATE NOCASE OR (${effectiveBusiness}) LIKE ? ESCAPE '\\' COLLATE NOCASE)`;
    const prefix = search.replace(/[\\%_]/g, "\\$&") + "%";
    args.push(prefix, prefix, prefix);
  }
  if (filter === "paid")
    where +=
      " AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 p WHERE p.mode=a.mode AND p.google_subject=a.google_subject AND p.status='paid')";
  if (filter === "pilot")
    ((where +=
      " AND EXISTS(SELECT 1 FROM streamlion_free_pilot_accounts_v1 p WHERE p.mode=a.mode AND p.google_subject=a.google_subject AND p.state='active' AND p.ends_at>?)"),
      args.push(now));
  if (filter === "active" || filter === "inactive") {
    where += ` AND a.last_active_at${filter === "active" ? ">=" : "<"}?`;
    args.push(localStart(calendarDays(now, 30)[0]));
  }
  if (filter === "low")
    where +=
      " AND COALESCE((SELECT balance_micros FROM streamlion_credit_wallets_v1 w WHERE w.mode=a.mode AND w.google_subject=a.google_subject),0)+COALESCE((SELECT balance_micros FROM streamlion_promotional_wallets_v1 w WHERE w.mode=a.mode AND w.google_subject=a.google_subject),0)+COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 w WHERE w.mode=a.mode AND w.google_subject=a.google_subject),0)<3000000";
  const total = await db
    .prepare(
      `SELECT COUNT(*) n FROM streamlion_account_activity_v1 a JOIN streamlion_accounts_v1 u USING(google_subject) ${searchJoins} WHERE ${where}`,
    )
    .bind(...args)
    .first();
  if (params.get("cursor")) {
    let c;
    try {
      c = JSON.parse(atob(params.get("cursor")));
    } catch {}
    if (
      !c ||
      !Number.isSafeInteger(c.time) ||
      typeof c.subject !== "string" ||
      c.subject.length > 255
    )
      throw Object.assign(Error("Invalid cursor."), { status: 400 });
    where += ` AND (a.last_active_at${oldest ? ">" : "<"}? OR (a.last_active_at=? AND a.google_subject>?))`;
    args.push(c.time, c.time, c.subject);
  }
  const page = await rows(
    db,
    `SELECT u.*,a.last_active_at FROM streamlion_account_activity_v1 a INDEXED BY streamlion_admin_active_v1 JOIN streamlion_accounts_v1 u USING(google_subject) ${searchJoins} WHERE ${where} ORDER BY a.last_active_at ${direction},a.google_subject ASC LIMIT ?`,
    ...args,
    limit + 1,
  );
  const hasMore = page.length > limit;
  page.length = Math.min(page.length, limit);
  const users = await hydratePage(db, page, mode, now, days);
  const last = page.at(-1);
  return {
    users,
    total: total.n,
    nextCursor: hasMore
      ? btoa(
          JSON.stringify({
            time: last.last_active_at,
            subject: last.google_subject,
          }),
        )
      : null,
    days,
    asOf: now,
    mode,
    coverage:
      "Known accounts; historical signup dates may be unavailable. Activity includes server-observed and synced foreground use.",
  };
}
export async function userDetails(db, mode, subject, now, days = 30) {
  const row = await db
    .prepare(
      "SELECT u.*,COALESCE(a.last_active_at,0) last_active_at FROM streamlion_accounts_v1 u JOIN streamlion_account_activity_v1 a USING(google_subject) WHERE u.google_subject=? AND a.mode=?",
    )
    .bind(subject, mode)
    .first();
  if (!row) return null;
  const user = (await hydratePage(db, [row], mode, now, days))[0];
  const [grants, purchases, audit, legacy] = await Promise.all([
    rows(
      db,
      `SELECT g.id,g.amount_micros,g.reason,g.created_at,b.remaining_micros,COALESCE((SELECT SUM(a.amount_micros) FROM streamlion_goodwill_allocations_v1 a WHERE a.grant_id=g.id AND a.state='reserved'),0) reserved_micros,COALESCE((SELECT SUM(a.amount_micros) FROM streamlion_goodwill_allocations_v1 a WHERE a.grant_id=g.id AND a.state='complete'),0) consumed_micros,COALESCE((SELECT SUM(r.amount_micros) FROM streamlion_admin_reversals_v1 r WHERE r.grant_id=g.id),0) reversed_micros FROM streamlion_admin_grants_v1 g JOIN streamlion_admin_grant_balances_v1 b ON b.grant_id=g.id WHERE g.mode=? AND g.google_subject=? ORDER BY g.created_at DESC,g.id LIMIT 50`,
      mode,
      subject,
    ),
    rows(
      db,
      "SELECT order_id id,'core' kind,amount,amount_refunded,status,created_at FROM streamlion_purchases_v1 WHERE mode=? AND google_subject=? UNION ALL SELECT order_id,'credits',amount,amount_refunded,status,created_at FROM streamlion_credit_orders_v1 WHERE mode=? AND google_subject=? ORDER BY created_at DESC LIMIT 50",
      mode,
      subject,
      mode,
      subject,
    ),
    rows(
      db,
      "SELECT id,action,amount_micros,reason,created_at,reference,balance_before,balance_after FROM streamlion_admin_audit_v1 WHERE mode=? AND target=? ORDER BY created_at DESC,id LIMIT 50",
      mode,
      subject,
    ),
    db
      .prepare(
        "SELECT COUNT(*) n,COALESCE(SUM(price_micros),0) amount FROM streamlion_credit_turns_v1 t WHERE t.mode=? AND t.google_subject=? AND t.state='complete' AND NOT EXISTS(SELECT 1 FROM streamlion_shared_spends_v1 s WHERE s.mode=t.mode AND s.google_subject=t.google_subject AND s.id=t.request_id)",
      )
      .bind(mode, subject)
      .first(),
  ]);
  return {
    user,
    grants,
    purchases,
    audit,
    unreconciledLegacyAI: {
      count: legacy.n,
      credits: legacy.amount / CREDIT_UNIT,
    },
    allowance: await allowance(db, mode, now),
    asOf: now,
    historyLimit: 50,
  };
}
export async function overview(db, mode, now, days = 30) {
  const dates = calendarDays(now, days),
    from = localStart(dates[0]);
  const exclude =
    "NOT EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 o WHERE o.mode=a.mode AND o.google_subject=a.google_subject)";
  const counts = await db
    .prepare(
      `SELECT COUNT(*) registered,COALESCE(SUM(EXISTS(SELECT 1 FROM streamlion_purchases_v1 p WHERE p.mode=a.mode AND p.google_subject=a.google_subject AND p.status='paid')),0) paid,COALESCE(SUM(a.last_active_at>=?),0) active7,COALESCE(SUM(a.last_active_at>=?),0) active30 FROM streamlion_account_activity_v1 a WHERE a.mode=? AND ${exclude}`,
    )
    .bind(
      localStart(calendarDays(now, 7)[0]),
      localStart(calendarDays(now, 30)[0]),
      mode,
    )
    .first();
  const activity = await rows(
    db,
    `SELECT d.reporting_date day,COUNT(*) active FROM streamlion_account_days_v1 d JOIN streamlion_account_activity_v1 a ON a.mode=d.mode AND a.google_subject=d.google_subject WHERE d.mode=? AND d.reporting_date>=? AND d.reporting_date<=? AND ${exclude} GROUP BY d.reporting_date`,
    mode,
    dates[0],
    localDate(now),
  );
  const charges = await rows(
    db,
    "SELECT * FROM (SELECT s.purpose kind,s.amount,s.state,s.created_at FROM streamlion_shared_spends_v1 s WHERE s.mode=? AND s.created_at>=? AND s.created_at<=? AND NOT EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 o WHERE o.mode=s.mode AND o.google_subject=s.google_subject) UNION ALL SELECT 'speech',s.price_micros,s.state,s.created_at FROM streamlion_speech_turns_v1 s WHERE s.mode=? AND s.created_at>=? AND s.created_at<=? AND NOT EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 o WHERE o.mode=s.mode AND o.google_subject=s.google_subject)) ORDER BY created_at DESC LIMIT 5001",
    mode,
    from,
    now,
    mode,
    from,
    now,
  );
  const known = await rows(
    db,
    `SELECT u.first_known_at FROM streamlion_account_activity_v1 a JOIN streamlion_accounts_v1 u USING(google_subject) WHERE a.mode=? AND u.first_known_at>=? AND u.first_known_at<=? AND ${exclude} ORDER BY u.first_known_at DESC LIMIT 5001`,
    mode,
    from,
    now,
  );
  const partial = charges.length > 5000 || known.length > 5000;
  const trend = dates.map((day) => ({
    day,
    active: activity.find((a) => a.day === day)?.active || 0,
    known: 0,
    ai: 0,
    coordination: 0,
    speech: 0,
  }));
  for (const k of known.slice(0, 5000)) {
    const bucket = trend.find((d) => d.day === localDate(k.first_known_at));
    if (bucket) bucket.known++;
  }
  let creditsUsed = 0,
    reserved = 0;
  for (const c of charges.slice(0, 5000)) {
    const bucket = trend.find((d) => d.day === localDate(c.created_at));
    if (!bucket) continue;
    if (c.state === "complete") {
      bucket[c.kind] += c.amount / CREDIT_UNIT;
      creditsUsed += c.amount / CREDIT_UNIT;
    } else if (c.state === "reserved") reserved += c.amount / CREDIT_UNIT;
  }
  const balances = await db
    .prepare(
      "SELECT COALESCE(SUM(w.balance_micros),0) purchased FROM streamlion_credit_wallets_v1 w WHERE w.mode=? AND NOT EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 o WHERE o.mode=w.mode AND o.google_subject=w.google_subject)",
    )
    .bind(mode)
    .first();
  const good = await db
    .prepare(
      "SELECT COALESCE(SUM(w.balance_micros),0) n FROM streamlion_goodwill_available_v1 w WHERE w.mode=? AND NOT EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 o WHERE o.mode=w.mode AND o.google_subject=w.google_subject)",
    )
    .bind(mode)
    .first();
  return {
    ...counts,
    mode,
    days,
    asOf: now,
    timezone: "America/New_York",
    creditsUsed,
    reserved,
    purchasedAvailable: balances.purchased / CREDIT_UNIT,
    goodwillAvailable: good.n / CREDIT_UNIT,
    trend,
    partial,
    allowance: await allowance(db, mode, now),
    coverage:
      "Known accounts; activity tracking starts with this migration. Completed charges are grouped by original request date. Unmatched historical AI is excluded pending reconciliation.",
  };
}
export async function creditActivity(db, mode, params, now) {
  let where = "a.mode=?",
    args = [mode];
  const cursor = params.get("cursor");
  if (cursor) {
    let c;
    try {
      c = JSON.parse(atob(cursor));
    } catch {}
    if (
      !c ||
      !Number.isSafeInteger(c.time) ||
      typeof c.id !== "string" ||
      c.id.length > 300
    )
      throw Object.assign(Error("Invalid cursor."), { status: 400 });
    where += " AND (a.created_at<? OR (a.created_at=? AND a.id<?))";
    args.push(c.time, c.time, c.id);
  }
  const result = await rows(
    db,
    `SELECT a.id,a.target,COALESCE(u.email,'') email,a.action,a.amount_micros,a.reason,a.created_at,a.reference FROM streamlion_admin_audit_v1 a LEFT JOIN streamlion_accounts_v1 u ON u.google_subject=a.target WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,
    ...args,
  );
  const more = result.length > 50;
  result.length = Math.min(result.length, 50);
  const last = result.at(-1);
  return {
    entries: result,
    nextCursor: more
      ? btoa(JSON.stringify({ time: last.created_at, id: last.id }))
      : null,
    mode,
    asOf: now,
  };
}
