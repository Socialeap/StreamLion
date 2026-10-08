// Private operator tooling only. No browser endpoint, provider call or mutation.
export const SAMPLE_LIMIT = 5000;
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const DAY = 86400000;
const MARKERS = {
  auth: ["streamlion_auth_schema_v1", 1],
  folder: ["streamlion_google_folder_schema_v1", 1],
  purchase: ["streamlion_purchase_schema_v1", 1],
  launch: ["streamlion_purchase_schema_v2", 2],
  extension: ["streamlion_extension_schema_v1", 1],
  credits: ["streamlion_credit_schema_v1", 1],
  coordination: ["streamlion_coordination_schema_v1", 1],
  notifications: ["streamlion_coordination_notifications_schema_v1", 1],
  efficiency: ["streamlion_coordination_efficiency_schema_v1", 1],
};
const fail = (code) => {
  throw new Error(code);
};
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
function timestamp(value) {
  const n = typeof value === "number" ? value : Date.parse(value);
  if (!integer(n) || n < Date.UTC(2020, 0, 1) || n > Date.UTC(2100, 0, 1))
    fail("operations_timestamp");
  return n;
}

export function operationsQueries(asOf) {
  const now = timestamp(asOf),
    day = Math.floor(now / DAY);
  const date = new Date(now);
  const monthDay = Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY,
  );
  const queries = [];
  function direct(section, metrics, modes = ["all"]) {
    const expected = modes.flatMap((mode) =>
      Object.keys(metrics).map((metric) => ({ section, mode, metric })),
    );
    const sql = modes
      .flatMap((mode) =>
        Object.entries(metrics).map(
          ([metric, value]) =>
            `SELECT '${section}' AS section,'${mode}' AS mode,'${metric}' AS metric,${value.replaceAll("$MODE", `'${mode}'`)} AS value,${now} AS as_of_ms`,
        ),
      )
      .join(" UNION ALL ");
    queries.push({ section, expected, sql });
  }
  function sampled(section, source, metrics, modes = ["test", "live"]) {
    const names = Object.keys(metrics);
    const expected = [
      { section, mode: "all", metric: "sample_rows" },
      { section, mode: "all", metric: "unknown_mode_rows" },
      ...modes.flatMap((mode) =>
        names.map((metric) => ({ section, mode, metric })),
      ),
    ];
    const global = `SELECT '${section}' AS section,'all' AS mode,'sample_rows' AS metric,COUNT(*) AS value,${now} AS as_of_ms FROM b UNION ALL SELECT '${section}','all','unknown_mode_rows',COALESCE(SUM(CASE WHEN mode NOT IN (${modes.map((x) => `'${x}'`).join(",")}) OR mode IS NULL THEN 1 ELSE 0 END),0),${now} FROM b`;
    const sql = `WITH b AS (${source} LIMIT ${SAMPLE_LIMIT + 1}), modes(mode) AS (VALUES ${modes.map((x) => `('${x}')`).join(",")}), t AS (SELECT modes.mode,${Object.entries(
      metrics,
    )
      .map(([name, expr]) => `${expr} AS ${name}`)
      .join(
        ",",
      )} FROM modes LEFT JOIN b ON b.mode=modes.mode GROUP BY modes.mode) ${global} ${names.map((name) => `UNION ALL SELECT '${section}',mode,'${name}',${name},${now} FROM t`).join(" ")}`;
    queries.push({ section, expected, sql });
  }
  const count = (condition) =>
    `COALESCE(SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END),0)`;
  const sum = (expression) => `COALESCE(SUM(${expression}),0)`;
  const oldest = (condition) =>
    `COALESCE(MAX(CASE WHEN ${condition} THEN MAX(0,${now}-b.created_at) ELSE 0 END),0)`;
  // Inner LIMITs precede joins; account identities never leave the query.
  const joined = (table, columns) => {
    const selected = [
      ...new Set([
        "connection_id",
        ...Array.from(columns.matchAll(/a\.(\w+)/g), (m) => m[1]),
      ]),
    ];
    return `SELECT c.mode,${columns} FROM (SELECT ${selected.join(",")} FROM ${table} LIMIT ${SAMPLE_LIMIT + 1}) a LEFT JOIN streamlion_coordination_connections_v1 c ON c.id=a.connection_id`;
  };
  direct(
    "schema",
    Object.fromEntries(
      Object.entries(MARKERS).map(([name, [table, version]]) => [
        name,
        `(SELECT COUNT(*) FROM ${table} WHERE version=${version})`,
      ]),
    ),
  );
  sampled(
    "connections",
    "SELECT mode,revoked,expires_at FROM streamlion_coordination_connections_v1",
    {
      active: count(`b.revoked=0 AND b.expires_at>${now}`),
      revoked: count("b.revoked=1"),
      expired: count(`b.revoked=0 AND b.expires_at<=${now}`),
      expires_7_days: count(
        `b.revoked=0 AND b.expires_at>${now} AND b.expires_at<=${now + 7 * DAY}`,
      ),
    },
  );
  sampled(
    "jobs",
    joined(
      "streamlion_coordination_jobs_v1",
      "a.closed_at,a.archive_at,a.archived",
    ),
    {
      open: count("b.closed_at IS NULL AND b.archived=0"),
      closed_retained: count("b.closed_at IS NOT NULL AND b.archived=0"),
      archived: count("b.archived=1"),
      archive_overdue: count(`b.archived=0 AND b.archive_at<=${now}`),
      deadline_14_days: count(
        `b.archived=0 AND b.archive_at>${now} AND b.archive_at<=${now + 14 * DAY}`,
      ),
    },
  );
  sampled(
    "operations",
    joined(
      "streamlion_coordination_operations_v1",
      "a.state,a.created_at,a.completed_at,c.revoked,c.expires_at",
    ),
    {
      pending: count("b.state='pending'"),
      pending_oldest_ms: oldest("b.state='pending'"),
      pending_without_grant: count(
        `b.state='pending' AND (b.revoked=1 OR b.expires_at<=${now})`,
      ),
      failed: count("b.state='failed'"),
      complete_24_hours: count(
        `b.state='complete' AND b.completed_at>=${now - DAY} AND b.completed_at<=${now}`,
      ),
    },
  );
  const notices = (table) => {
    const result = table.endsWith("push_outbox_v1") ? "accepted" : "status";
    return `SELECT c.mode,a.created_at,a.sent_at,a.attempts,a.${result} FROM (SELECT job_id,created_at,sent_at,attempts,${result} FROM ${table} LIMIT ${SAMPLE_LIMIT + 1}) a LEFT JOIN streamlion_coordination_jobs_v1 j ON j.id=a.job_id LEFT JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id`;
  };
  sampled("mail", notices("streamlion_coordination_outbox_v1"), {
    ...Object.fromEntries(
      [
        "queued",
        "accepted",
        "delivered",
        "bounced",
        "complained",
        "failed",
        "skipped",
        "uncertain",
      ].map((s) => [s, count(`b.status='${s}'`)]),
    ),
    waiting_oldest_ms: oldest("b.status IN ('queued','uncertain')"),
    attempts_retained: sum("b.attempts"),
  });
  sampled("push", notices("streamlion_coordination_push_outbox_v1"), {
    waiting: count("b.sent_at IS NULL AND b.attempts<5"),
    exhausted: count("b.sent_at IS NULL AND b.attempts>=5"),
    accepted: count("b.accepted=1"),
    waiting_oldest_ms: oldest("b.sent_at IS NULL"),
  });
  direct(
    "maintenance",
    {
      row_present:
        "(SELECT COUNT(*) FROM streamlion_coordination_maintenance_v1 WHERE mode=$MODE)",
      next_cleanup_at:
        "COALESCE((SELECT next_cleanup_at FROM streamlion_coordination_maintenance_v1 WHERE mode=$MODE),0)",
      overdue_ms: `MAX(0,${now}-COALESCE((SELECT next_cleanup_at FROM streamlion_coordination_maintenance_v1 WHERE mode=$MODE),0))`,
    },
    ["test", "live"],
  );
  direct("email_budget", {
    daily_attempts: `(SELECT COALESCE(SUM(attempts),0) FROM streamlion_coordination_email_budget_v1 WHERE day=${day})`,
    monthly_attempts: `(SELECT COALESCE(SUM(attempts),0) FROM streamlion_coordination_email_budget_v1 WHERE day BETWEEN ${monthDay} AND ${day})`,
  });
  const minute = Math.floor(now / 60000) * 60000;
  direct(
    "google_budget",
    Object.fromEntries(
      ["read", "write"].map((kind) => [
        `${kind}_this_minute`,
        `(SELECT COALESCE(SUM(used),0) FROM streamlion_google_request_limits_v1 WHERE scope='project:${kind}' AND window_start=${minute})`,
      ]),
    ),
  );
  direct(
    "coordination_policy",
    {
      row_present:
        "(SELECT COUNT(*) FROM streamlion_coordination_policy_v1 WHERE mode=$MODE)",
      active:
        "COALESCE((SELECT active FROM streamlion_coordination_policy_v1 WHERE mode=$MODE),0)",
      project_micros:
        "COALESCE((SELECT project_micros FROM streamlion_coordination_policy_v1 WHERE mode=$MODE),0)",
    },
    ["test", "live"],
  );
  direct(
    "credit_policy",
    {
      row_present:
        "(SELECT COUNT(*) FROM streamlion_credit_policy_v1 WHERE mode=$MODE)",
      ...Object.fromEntries(
        [
          "active",
          "cost_micros",
          "daily_budget_micros",
          "total_budget_micros",
          "daily_requests",
        ].map((x) => [
          x,
          `COALESCE((SELECT ${x} FROM streamlion_credit_policy_v1 WHERE mode=$MODE),0)`,
        ]),
      ),
    },
    ["test", "live"],
  );
  const aiMetrics = {
    attempts_today: count(
      `b.created_at>=${day * DAY} AND b.created_at<=${now}`,
    ),
    failed_today: count(
      `b.state='failed' AND b.created_at>=${day * DAY} AND b.created_at<=${now}`,
    ),
    pending: count("b.state='reserved'"),
    pending_oldest_ms: oldest("b.state='reserved'"),
    reserved_today_micros: sum(
      `CASE WHEN b.created_at>=${day * DAY} AND b.created_at<=${now} THEN b.reserve_micros ELSE 0 END`,
    ),
    reserved_retained_micros: sum("b.reserve_micros"),
  };
  sampled(
    "credit_turns",
    "SELECT mode,state,created_at,reserve_micros FROM streamlion_credit_turns_v1",
    aiMetrics,
  );
  sampled(
    "pilot_turns",
    "SELECT 'pilot' AS mode,state,created_at,reserve_micros FROM streamlion_ai_turns_v1",
    aiMetrics,
    ["pilot"],
  );
  direct(
    "pilot_policy",
    {
      row_present: "(SELECT COUNT(*) FROM streamlion_ai_policy_v1 WHERE id=1)",
      ...Object.fromEntries(
        ["active", "price_micros", "daily_budget_micros", "daily_requests"].map(
          (x) => [
            x,
            `COALESCE((SELECT ${x} FROM streamlion_ai_policy_v1 WHERE id=1),0)`,
          ],
        ),
      ),
    },
    ["pilot"],
  );
  const payments = {
    paid_orders: count("b.status='paid'"),
    waiting_orders: count("b.status IN ('pending','processing')"),
    refunded_orders: count("b.status='refunded'"),
    disputed_orders: count("b.status='disputed'"),
    recorded_gross_cents: sum(
      "CASE WHEN b.status IN ('paid','refunded','disputed') THEN b.amount ELSE 0 END",
    ),
    recorded_refund_cents: sum("b.amount_refunded"),
  };
  for (const [section, table] of [
    ["core_orders", "streamlion_purchases_v1"],
    ["credit_orders", "streamlion_credit_orders_v1"],
  ])
    sampled(
      section,
      `SELECT mode,status,amount,amount_refunded FROM ${table}`,
      payments,
    );
  return queries;
}

export function parseOperations(input, now = Date.now()) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30)
    fail("operations_response");
  const first = input[0]?.results?.[0];
  const asOf = timestamp(first?.as_of_ms);
  if (asOf > now + 60000 || now - asOf > DAY) fail("operations_snapshot_stale");
  const expected = operationsQueries(asOf).flatMap((q) => q.expected);
  const allowed = new Set(
    expected.map((r) => `${r.section}/${r.mode}/${r.metric}`),
  );
  const seen = new Set(),
    metrics = {};
  let rowsRead = 0,
    durationMs = 0;
  for (const part of input) {
    if (
      part.success !== true ||
      !Array.isArray(part.results) ||
      part.results.length > 200
    )
      fail("operations_response");
    if (
      !part.meta ||
      !integer(part.meta.rows_read) ||
      part.meta.rows_written !== 0 ||
      !Number.isFinite(part.meta.duration) ||
      part.meta.duration < 0
    )
      fail("operations_read_receipt");
    rowsRead += part.meta.rows_read;
    durationMs += part.meta.duration;
    for (const row of part.results) {
      if (
        !row ||
        Object.keys(row).sort().join(",") !==
          "as_of_ms,metric,mode,section,value" ||
        row.as_of_ms !== asOf ||
        !integer(row.value)
      )
        fail("operations_metric_shape");
      const key = `${row.section}/${row.mode}/${row.metric}`;
      if (!allowed.has(key) || seen.has(key))
        fail("operations_unexpected_metric");
      seen.add(key);
      (metrics[row.section] ??= {})[row.mode] ??= {};
      metrics[row.section][row.mode][row.metric] = row.value;
    }
  }
  if (seen.size !== allowed.size || !integer(rowsRead) || rowsRead > 250000)
    fail("operations_incomplete");
  if (Object.values(metrics.schema.all).some((value) => value !== 1))
    fail("operations_schema");
  const findings = [];
  if (now - asOf > 300000)
    findings.push({ code: "stale_snapshot", section: "snapshot", mode: "all" });
  for (const [section, values] of Object.entries(metrics)) {
    if (values.all?.sample_rows > SAMPLE_LIMIT)
      findings.push({ code: "truncated", section, mode: "all" });
    if (values.all?.unknown_mode_rows > 0)
      findings.push({ code: "unknown_binding", section, mode: "all" });
  }
  for (const mode of ["test", "live"]) {
    for (const section of [
      "maintenance",
      "coordination_policy",
      "credit_policy",
    ])
      if (metrics[section][mode].row_present !== 1)
        findings.push({ code: "policy_missing", section, mode });
    if (metrics.operations[mode].pending > 0)
      findings.push({ code: "pending_write", section: "operations", mode });
    if (metrics.operations[mode].pending_without_grant > 0)
      findings.push({ code: "reconnect", section: "operations", mode });
    if (metrics.jobs[mode].archive_overdue > 0)
      findings.push({ code: "archive_due", section: "jobs", mode });
    if (metrics.mail[mode].uncertain > 0)
      findings.push({ code: "uncertain_mail", section: "mail", mode });
    if (
      metrics.mail[mode].bounced +
        metrics.mail[mode].complained +
        metrics.mail[mode].failed >
      0
    )
      findings.push({ code: "delivery_review", section: "mail", mode });
    if (metrics.push[mode].exhausted > 0)
      findings.push({ code: "push_review", section: "push", mode });
    if (
      metrics.coordination_policy[mode].active === 1 &&
      metrics.maintenance[mode].overdue_ms > 3600000
    )
      findings.push({ code: "cleanup_due", section: "maintenance", mode });
  }
  if (metrics.pilot_policy.pilot.row_present !== 1)
    findings.push({
      code: "policy_missing",
      section: "pilot_policy",
      mode: "all",
    });
  return {
    kind: "streamlion.private.operations",
    version: 1,
    asOf: new Date(asOf).toISOString(),
    observedAt: new Date(now).toISOString(),
    sampleLimit: SAMPLE_LIMIT,
    status: findings.length ? "attention" : "snapshot_consistent",
    launchDecision:
      "HOLD — device, commercial, cost and scale acceptance remain separate",
    queryReceipt: { rowsRead, rowsWritten: 0, durationMs },
    findings,
    metrics,
  };
}

export const COST_KEYS = [
  "provider",
  "hosting",
  "storage",
  "email",
  "payments",
  "failures",
  "promotions",
  "support",
  "fixed",
];
// Inputs are costs allocated to ONE service for ONE period, including free,
// abandoned and failed work. Paid units alone amortize that complete cost.
export function allocateCost(paidUnits, costs) {
  if (!Number.isSafeInteger(paidUnits) || paidUnits < 1 || paidUnits > 1000000)
    return { status: "incomplete", missing: ["paid_units"] };
  const missing = COST_KEYS.filter(
    (k) => costs[k] === null || costs[k] === undefined || costs[k] === "",
  );
  if (missing.length) return { status: "incomplete", missing };
  const values = COST_KEYS.map((k) => costs[k]);
  if (
    values.some(
      (n) =>
        typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10000000,
    )
  )
    return { status: "invalid" };
  const periodMicros = values.reduce((s, n) => s + Math.ceil(n * 1000000), 0);
  const unitMicros = Math.ceil(periodMicros / paidUnits);
  const markupPriceMicros = Number((BigInt(unitMicros) * 130n + 99n) / 100n);
  return {
    status: "scenario_complete",
    periodMicros,
    unitMicros,
    markupPriceMicros,
    approved: false,
  };
}

export const jsonForHtml = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
