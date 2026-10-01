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
  reserveFieldFileId,
  retainFieldFile,
  createWorkbook,
  moveWorkbookToFolder,
  restoreGoogleSession,
  googleFolderId,
  rememberGoogleFolder,
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
test("Drive field upload reconciles a lost acknowledgment by verified ID and digest without duplicating a file", async () => {
  let file = null,
    posts = 0;
  const blob = new Blob(["synthetic recording"], { type: "audio/webm" });
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${fakeToken}`);
    if (url.includes("generateIds"))
      return {
        ok: true,
        status: 200,
        json: async () => ({ ids: ["reserved-file"] }),
      };
    if (options.method === "POST") {
      posts++;
      const metadata = JSON.parse(
        (await options.body.text()).split("\r\n\r\n")[1].split("\r\n--")[0],
      );
      file = {
        id: metadata.id,
        size: String(blob.size),
        appProperties: metadata.appProperties,
        trashed: false,
      };
      throw new Error("Upload acknowledgment lost");
    }
    return file
      ? { ok: true, status: 200, json: async () => file }
      : { ok: false, status: 404 };
  };
  await connectGoogle("test.apps.googleusercontent.com");
  const fileId = await reserveFieldFileId();
  const input = {
    fileId,
    bookId: "book",
    noteId: "note",
    name: "field.webm",
    blob,
  };
  await assert.rejects(retainFieldFile(input), /acknowledgment lost/);
  assert.equal(
    await retainFieldFile(input),
    "https://drive.google.com/file/d/reserved-file/view",
  );
  assert.equal(posts, 1);
  file.appProperties.streamlionBook = "different-book";
  await assert.rejects(retainFieldFile(input), /does not match/);
  assert.equal(posts, 1);
  disconnectGoogle();
});
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
test("concurrent workbook reads share one request pair and subsequent reads fetch fresh data", async () => {
  const tables = { Projects: [PROJECT_HEADERS], Observations: [NOTE_HEADERS] };
  let reads = 0;
  globalThis.fetch = async (url) => {
    reads++;
    await new Promise((resolve) => setTimeout(resolve, 1));
    return {
      ok: true,
      json: async () =>
        url.includes("values:batchGet")
          ? { valueRanges: Object.values(tables).map((values) => ({ values })) }
          : {
              sheets: Object.keys(tables).map((title) => ({
                properties: { title, gridProperties: { rowCount: 1000 } },
              })),
            },
    };
  };
  await connectGoogle("test.apps.googleusercontent.com");
  await Promise.all([
    readWorkbook("book"),
    readWorkbook("book"),
    readWorkbook("book"),
  ]);
  assert.equal(reads, 2);
  tables.Projects.push(
    rowFor(
      makeRevision(validateFields({ title: "Newly saved" }), null, "fresh-job"),
      PROJECT_HEADERS,
    ),
  );
  assert.equal((await readWorkbook("book")).Projects[0].title, "Newly saved");
  assert.equal(reads, 4);
  disconnectGoogle();
});

test("new workbook is moved once and new field files use a folder isolated to their project", async () => {
  const files = new Map();
  let next = 0,
    moves = 0;
  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), { status });
  globalThis.fetch = async (target, options = {}) => {
    const url = new URL(target);
    if (url.hostname === "sheets.googleapis.com") {
      files.set("new-book", {
        id: "new-book",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: ["root"],
      });
      return reply({ spreadsheetId: "new-book" });
    }
    if (url.pathname.endsWith("/generateIds"))
      return reply({ ids: ["reserved-" + next++] });
    if (url.pathname === "/upload/drive/v3/files") {
      const metadata = JSON.parse(
        (await options.body.text()).split("\r\n\r\n")[1].split("\r\n--")[0],
      );
      files.set(metadata.id, { ...metadata, size: String(blob.size) });
      return reply({ id: metadata.id });
    }
    if (options.method === "PATCH") {
      moves++;
      const id = url.pathname.split("/").at(-1);
      const file = files.get(id);
      file.parents = [url.searchParams.get("addParents")];
      return reply(file);
    }
    if (options.method === "POST") {
      const data = JSON.parse(options.body);
      files.set(data.id, { ...data, capabilities: { canAddChildren: true } });
      return reply({ id: data.id });
    }
    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q");
      return reply({
        files: [...files.values()]
          .filter(
            (file) =>
              file.mimeType === "application/vnd.google-apps.folder" &&
              Object.entries(file.appProperties).every(([k, v]) =>
                q.includes(`key='${k}' and value='${v}'`),
              ) &&
              (!q.includes(" in parents") ||
                file.parents?.some((parent) =>
                  q.includes(`'${parent}' in parents`),
                )),
          )
          .map(({ id }) => ({ id })),
      });
    }
    const file = files.get(url.pathname.split("/").at(-1));
    return file ? reply(file) : reply({}, 404);
  };
  const blob = new Blob(["field photo"], { type: "image/jpeg" });
  await connectGoogle("test.apps.googleusercontent.com");
  const book = await createWorkbook();
  await moveWorkbookToFolder(book.spreadsheetId);
  await moveWorkbookToFolder(book.spreadsheetId);
  assert.equal(moves, 1);
  assert.deepEqual(files.get("new-book").parents, [googleFolderId()]);
  const id = await reserveFieldFileId();
  await retainFieldFile({
    fileId: id,
    noteId: "note-a",
    bookId: book.spreadsheetId,
    projectId: "project-a",
    projectTitle: "Synthetic visit",
    name: "photo.jpg",
    blob,
  });
  const image = files.get(id),
    folder = files.get(image.parents[0]);
  assert.equal(folder.appProperties.streamlionProject, "project-a");
  assert.equal(folder.appProperties.streamlionBook, "new-book");
  const parent = files.get(folder.parents[0]);
  assert.equal(parent.name, "Project files");
  assert.deepEqual(parent.parents, [googleFolderId()]);
  disconnectGoogle();
});
test("saved folder restores from account-scoped session and a cancelled selection cannot cross into another account", async () => {
  disconnectGoogle();
  let account = "account-a",
    release;
  globalThis.fetch = async (path) =>
    path === "/api/google/session"
      ? new Response(
          JSON.stringify({
            enabled: true,
            connected: true,
            subject: account,
            bookId: "book",
            folderId: account === "account-a" ? "folder-a" : "",
          }),
        )
      : {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              release = () =>
                resolve({
                  id: "folder-selected",
                  mimeType: "application/vnd.google-apps.folder",
                  capabilities: { canAddChildren: true },
                });
            }),
        };
  await restoreGoogleSession();
  assert.equal(googleFolderId(), "folder-a");
  const selection = rememberGoogleFolder("folder-selected");
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  disconnectGoogle();
  account = "account-b";
  await restoreGoogleSession();
  release();
  await assert.rejects(selection, /account changed/);
  assert.equal(googleFolderId(), "");
  disconnectGoogle();
});
