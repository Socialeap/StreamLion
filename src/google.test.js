import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  makeRevision,
  rowFor,
} from "./workbook.js";
import { validateFields } from "./project-schema.js";
import {
  connectGoogle,
  disconnectGoogle,
  appendRevision,
  readWorkbook,
} from "./google.js";
const fakeToken = "synthetic-test-token";
globalThis.window = {
  google: {
    accounts: {
      oauth2: {
        hasGrantedAllScopes: () => true,
        initTokenClient: ({ callback }) => ({
          requestAccessToken: () =>
            callback({ access_token: fakeToken, expires_in: 3600 }),
        }),
      },
    },
  },
};
globalThis.document = {
  createElement: () => ({ remove() {} }),
  head: { append: (s) => queueMicrotask(() => s.onload()) },
};
test("Google adapter uses RAW, verifies a write, and reconciles a lost acknowledgment without duplicate append", async () => {
  const fields = validateFields({
      title: "=not-a-formula",
      scope: "10 ft 4 3/32 in",
    }),
    revision = makeRevision(fields, null, "job");
  const tables = { Projects: [PROJECT_HEADERS], Observations: [NOTE_HEADERS] };
  let appends = 0;
  let lost = true;
  globalThis.fetch = async (url, opts) => {
    assert.equal(opts.headers.Authorization, `Bearer ${fakeToken}`);
    if (url.includes(":append")) {
      assert.ok(url.includes("valueInputOption=RAW"));
      appends++;
      tables.Projects.push(...JSON.parse(opts.body).values);
      if (lost) {
        lost = false;
        throw new Error("Network acknowledgment lost");
      }
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes("values:batchGet")) {
      assert.deepEqual(new URL(url).searchParams.getAll("ranges"), [
        "Projects!1:1000",
        "Observations!1:1000",
      ]);
      return {
        ok: true,
        json: async () => ({
          valueRanges: Object.values(tables).map((values) => ({ values })),
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        sheets: Object.keys(tables).map((title) => ({
          properties: { title, gridProperties: { rowCount: 1000 } },
        })),
      }),
    };
  };
  await connectGoogle("test.apps.googleusercontent.com");
  await assert.rejects(appendRevision("book", "Projects", revision), /lost/);
  const after = await appendRevision("book", "Projects", revision);
  assert.equal(appends, 1);
  assert.equal(after.Projects[0].title, "=not-a-formula");
  const stale = { ...after.Projects[0] };
  tables.Projects[1][PROJECT_HEADERS.indexOf("scope")] = "Externally edited";
  await assert.rejects(
    appendRevision("book", "Projects", makeRevision(fields, stale), stale),
    /changed/,
  );
  assert.equal(appends, 1);
  disconnectGoogle();
  await assert.rejects(readWorkbook("book"), /expired/);
});
