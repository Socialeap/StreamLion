import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("ordinary authentication imports avoid reporting initialization; reporting reuses one formatter", () => {
  // A fresh process represents a cold module graph without changing Intl in
  // the concurrent test runner. Count expensive native construction rather
  // than asserting machine-dependent elapsed milliseconds.
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        const NativeFormatter = Intl.DateTimeFormat;
        let constructions = 0;
        Intl.DateTimeFormat = function (...args) {
          constructions++;
          return new NativeFormatter(...args);
        };
        Object.setPrototypeOf(Intl.DateTimeFormat, NativeFormatter);
        Intl.DateTimeFormat.prototype = NativeFormatter.prototype;
        const auth = await import('./server/google-auth.js');
        const afterImport = constructions;
        await auth.hash('synthetic-session');
        const afterHash = constructions;
        const { localDate, localStart } = await import('./server/admin-data.js');
        const dates = [
          localDate(Date.parse('2026-03-08T04:59:59Z')),
          localDate(Date.parse('2026-03-08T05:00:00Z')),
          localDate(Date.parse('2026-11-01T05:30:00Z')),
          localDate(Date.parse('2026-11-01T06:30:00Z')),
        ];
        const starts = ['2026-03-08','2026-03-09','2026-11-01','2026-11-02']
          .map(day => new Date(localStart(day)).toISOString());
        console.log(JSON.stringify({afterImport,afterHash,afterReporting:constructions,dates,starts}));
      `,
    ],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8" },
  );
  const data = JSON.parse(result);
  assert.equal(
    data.afterImport,
    0,
    "authentication must not initialize reporting dates",
  );
  assert.equal(
    data.afterHash,
    0,
    "session hashing must not initialize reporting dates",
  );
  assert.equal(
    data.afterReporting,
    1,
    "reuse the reporting formatter within the isolate",
  );
  assert.deepEqual(data.dates, [
    "2026-03-07",
    "2026-03-08",
    "2026-11-01",
    "2026-11-01",
  ]);
  assert.deepEqual(data.starts, [
    "2026-03-08T05:00:00.000Z",
    "2026-03-09T04:00:00.000Z",
    "2026-11-01T04:00:00.000Z",
    "2026-11-02T05:00:00.000Z",
  ]);
});
