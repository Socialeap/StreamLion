import { TABS, assertHeaders, readRecordHistory } from "./workbook.js";

// Read-only diagnostics. A report must never become a partial editable snapshot
// or an instruction to choose the newest branch automatically.
export function inspectWorkbook(tables) {
  const tabs = {};
  for (const [tab, headers] of Object.entries(TABS)) {
    const rows = tables?.[tab];
    const report = {
      gridRows: Array.isArray(rows) ? rows.length : 0,
      ready: false,
      issues: [],
    };
    tabs[tab] = report;
    try {
      if (!Array.isArray(rows)) throw new Error("missing table");
      assertHeaders(rows, headers);
    } catch {
      report.issues.push({ code: "headers-or-missing-tab", rows: [1] });
      continue;
    }
    if (rows.length > 10000) {
      report.issues.push({ code: "row-cap", rows: [] });
      continue;
    }
    const groups = new Map(),
      revisionRows = new Map();
    rows.slice(1).forEach((values, index) => {
      const row = index + 2;
      if (!Array.isArray(values)) {
        report.issues.push({ code: "invalid-row", rows: [row] });
        return;
      }
      if (!values.some((v) => v !== "" && v != null)) return;
      const key = String(values[0] ?? "");
      const group = groups.get(key) || [];
      group.push({ row, values });
      groups.set(key, group);
      const revision = String(values[1] ?? "");
      const previous = revisionRows.get(revision);
      if (
        previous &&
        JSON.stringify(previous.values) !== JSON.stringify(values)
      )
        report.issues.push({
          code: "conflicting-revision",
          rows: [previous.row, row],
        });
      else revisionRows.set(revision, { row, values });
    });
    for (const group of groups.values()) {
      try {
        readRecordHistory(
          [headers, ...group.map((item) => item.values)],
          headers,
        );
      } catch {
        report.issues.push({
          code: "invalid-or-forked-record-history",
          rows: group.map((item) => item.row),
        });
      }
    }
    if (!report.issues.length) {
      try {
        const history = readRecordHistory(rows, headers);
        report.ready = true;
        report.records = history.heads.length;
        report.uniqueRevisions = history.revisions.length;
        report.identicalRetryRows =
          rows.slice(1).filter((r) => r.some((v) => v !== "" && v != null))
            .length - history.revisions.length;
      } catch {
        report.issues.push({ code: "cross-record-history-conflict", rows: [] });
      }
    }
  }
  return {
    ready: Object.values(tabs).every((tab) => tab.ready),
    readOnly: true,
    tabs,
  };
}
