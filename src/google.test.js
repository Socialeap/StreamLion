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

for (const tab of ["Projects", "Observations"]) {
  test(`${tab}: retry and readback find a saved ancestor without overwriting its child`, async () => {
    const headers = tab === "Projects" ? PROJECT_HEADERS : NOTE_HEADERS;
    const project = makeRevision(
      validateFields({ title: "Project" }),
      null,
      "parent-project",
    );
    const fields =
      tab === "Projects"
        ? validateFields({ title: "First version" })
        : {
            projectId: project.recordId,
            area: "Wall",
            text: "First version",
            sourceText: "First version",
            audioUrl: "",
          };
    const changedField = tab === "Projects" ? "title" : "text";
    const tables = {
      Projects: [PROJECT_HEADERS, rowFor(project, PROJECT_HEADERS)],
      Observations: [NOTE_HEADERS],
    };
    let appends = 0,
      loseAcknowledgment = true,
      child;
    globalThis.fetch = async (url, options) => {
      if (url.includes(":append")) {
        appends++;
        const row = JSON.parse(options.body).values[0];
        tables[tab].push(row);
        const saved = Object.fromEntries(
          headers.map((key, i) => [key, row[i]]),
        );
        child = makeRevision(
          { ...fields, [changedField]: "Later client revision" },
          saved,
        );
        tables[tab].push(rowFor(child, headers));
        if (loseAcknowledgment) {
          loseAcknowledgment = false;
          throw new Error("Acknowledgment lost");
        }
        return { ok: true, json: async () => ({}) };
      }
      if (url.includes("values:batchGet"))
        return {
          ok: true,
          json: async () => ({
            valueRanges: Object.values(tables).map((values) => ({ values })),
          }),
        };
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
    const revision = makeRevision(fields, null, "record-A");
    await assert.rejects(
      appendRevision("book", tab, revision),
      /Acknowledgment lost/,
    );
    const recovered = await appendRevision("book", tab, revision);
    assert.equal(appends, 1, "retry must not append the ancestor again");
    assert.equal(
      recovered[tab].find((r) => r.recordId === revision.recordId).revisionId,
      child.revisionId,
    );
    await assert.rejects(
      appendRevision("book", tab, {
        ...revision,
        [changedField]: "Different payload",
      }),
      /different content/,
    );
    tables[tab].push(rowFor(makeRevision(fields, revision), headers));
    await assert.rejects(
      appendRevision("book", tab, revision),
      /Concurrent edits/,
    );
    tables[tab].pop();
    const next = makeRevision(fields, null, "record-B");
    const verified = await appendRevision("book", tab, next);
    assert.equal(appends, 2);
    assert.equal(
      verified[tab].find((r) => r.recordId === next.recordId).revisionId,
      child.revisionId,
    );
    disconnectGoogle();
  });
}
