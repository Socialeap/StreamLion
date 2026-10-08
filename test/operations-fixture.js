import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { operationsQueries } from "../scripts/lib/operations-report.mjs";

export const OPERATIONS_NOW = Date.UTC(2026, 9, 8, 10, 0);
export function operationsFixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL(file, directory), "utf8"));
  const now = OPERATIONS_NOW;
  for (const [id, mode, revoked, expiry] of [
    ["private-connection-a", "test", 0, now + 86400000],
    ["private-connection-b", "live", 1, now - 1],
  ]) {
    sql
      .prepare(
        "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        "LEAK_PRIVATE_ACCOUNT",
        mode,
        "LEAK_PRIVATE_WORKBOOK_" + id,
        "LEAK_PRIVATE_FOLDER",
        "LEAK_ENCRYPTED_CREDENTIALS",
        "LEAK_PRIVATE_BRAND",
        expiry,
        revoked,
      );
  }
  for (const [id, connection, closed, deadline, archived] of [
    ["private-job-open", "private-connection-a", null, null, 0],
    ["private-job-closed", "private-connection-a", now - 86400000, now - 1, 0],
    [
      "private-job-archived",
      "private-connection-b",
      now - 86400000,
      now - 1,
      1,
    ],
  ]) {
    sql
      .prepare(
        "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,closed_at,archive_at,archived,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        connection,
        "LEAK_PROJECT_" + id,
        "LEAK_PRIVATE_EMAIL@example.invalid",
        closed,
        deadline,
        archived,
        now - 86400000,
      );
  }
  for (const [id, connection, state, age, completed] of [
    ["private-pending-a", "private-connection-a", "pending", 120000, null],
    ["private-pending-b", "private-connection-b", "pending", 3600000, null],
    ["private-complete", "private-connection-a", "complete", 60000, now - 1000],
  ]) {
    sql
      .prepare(
        "INSERT INTO streamlion_coordination_operations_v1 VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        connection,
        "private-job-open",
        "provider",
        "LEAK_FINGERPRINT",
        "LEAK_ENCRYPTED_CUSTOMER_BRIEF",
        state,
        now - age,
        completed,
      );
  }
  for (const [i, status] of [
    "queued",
    "uncertain",
    "delivered",
    "bounced",
    "accepted",
  ].entries()) {
    sql
      .prepare(
        "INSERT INTO streamlion_coordination_outbox_v1(id,job_id,payload,created_at,sent_at,attempts,status) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "private-notice-" + i,
        "private-job-open",
        "LEAK_MAIL_CONTENT",
        now - 100000 - i,
        status === "queued" ? null : now - 1000,
        i,
        status,
      );
  }
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_push_outbox_v1(id,notice_id,subscription_id,job_id,created_at,sent_at,attempts,accepted) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "private-push",
      "private-notice-1",
      "LEAK_ENDPOINT",
      "private-job-open",
      now - 10000,
      null,
      5,
      0,
    );
  const day = Math.floor(now / 86400000);
  sql
    .prepare("INSERT INTO streamlion_coordination_email_budget_v1 VALUES(?,?)")
    .run(day, 22);
  sql
    .prepare("INSERT INTO streamlion_coordination_email_budget_v1 VALUES(?,?)")
    .run(day - 1, 2);
  sql
    .prepare("INSERT INTO streamlion_google_request_limits_v1 VALUES(?,?,?)")
    .run("project:read", Math.floor(now / 60000) * 60000, 17);
  sql
    .prepare(
      "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='test'",
    )
    .run();
  sql
    .prepare(
      "UPDATE streamlion_coordination_maintenance_v1 SET next_cleanup_at=? WHERE mode='test'",
    )
    .run(now + 3600000);
  for (const [mode, status, amount, refund] of [
    ["test", "paid", 3995, 1998],
    ["live", "refunded", 3995, 3995],
  ]) {
    sql
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,amount_refunded,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,'usd',?,?,?,?,?)",
      )
      .run(
        "LEAK_ORDER_" + mode,
        mode,
        "LEAK_PRIVATE_ACCOUNT",
        "LEAK_PAY_EMAIL@example.invalid",
        "LEAK_PRICE",
        "LEAK_PRODUCT",
        amount,
        status,
        refund,
        now,
        now + 1000,
        now,
      );
  }
  sql.exec(
    "UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=18000,total_budget_micros=18000,daily_requests=3 WHERE mode='test'",
  );
  sql
    .prepare(
      "INSERT INTO streamlion_credit_wallets_v1 VALUES('test','LEAK_PRIVATE_ACCOUNT',100000)",
    )
    .run();
  for (const [id, state] of [
    ["LEAK_TURN_COMPLETE", "complete"],
    ["LEAK_TURN_FAILED", "failed"],
  ]) {
    sql
      .prepare(
        "INSERT INTO streamlion_credit_turns_v1 VALUES('test','LEAK_PRIVATE_ACCOUNT',?,?,7800,6000,'reserved')",
      )
      .run(id, now - 10000);
    sql
      .prepare(
        "UPDATE streamlion_credit_turns_v1 SET state=? WHERE request_id=?",
      )
      .run(state, id);
  }
  return sql;
}
export function operationsResponse(sql, now = OPERATIONS_NOW) {
  return operationsQueries(now).map((query) => ({
    results: sql
      .prepare(query.sql)
      .all()
      .map((row) => ({ ...row })),
    success: true,
    meta: { rows_read: 12, rows_written: 0, duration: 0.5 },
  }));
}
