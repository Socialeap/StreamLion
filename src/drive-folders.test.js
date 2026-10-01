import test from "node:test";
import assert from "node:assert/strict";
import { folderAdapter, FOLDER_MIME } from "./drive-folders.js";

function fixture() {
  const files = new Map();
  let posts = 0,
    lost = false,
    emptySearch = false;
  const queries = [];
  const adapter = folderAdapter(
    async (path, options = {}) => {
      const url = new URL("https://www.googleapis.com/" + path);
      const reply = (data, status = 200) =>
        new Response(JSON.stringify(data), { status });
      if (options.method === "POST") {
        posts++;
        const data = JSON.parse(options.body);
        files.set(data.id, { ...data, capabilities: { canAddChildren: true } });
        if (lost) {
          lost = false;
          throw new Error("acknowledgement lost");
        }
        return reply({ id: data.id });
      }
      if (url.pathname === "/drive/v3/files") {
        const q = url.searchParams.get("q");
        queries.push(q);
        const matches = [...files.values()].filter(
          (file) =>
            !file.trashed &&
            file.mimeType === FOLDER_MIME &&
            Object.entries(file.appProperties || {}).every(([k, v]) =>
              q.includes(`key='${k}' and value='${v}'`),
            ) &&
            (!q.includes(" in parents") ||
              file.parents?.some((parent) =>
                q.includes(`'${parent}' in parents`),
              )),
        );
        return reply({
          files: emptySearch ? [] : matches.map(({ id }) => ({ id })),
        });
      }
      const file = files.get(url.pathname.split("/").at(-1));
      return file ? reply(file) : reply({}, 404);
    },
    async () => "folder-" + files.size,
  );
  return {
    adapter,
    files,
    queries,
    posts: () => posts,
    lose: () => {
      lost = true;
      emptySearch = true;
    },
  };
}
test("folder creation reconciles an uncertain write with the same ID even before search catches up", async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(f.adapter.ensure("StreamLion", "workspace"), /lost/);
  const recovered = await f.adapter.ensure("StreamLion", "workspace");
  assert.equal(recovered.id, "folder-0");
  assert.equal(f.files.size, 1);
  assert.equal(f.posts(), 2);
});
test("concurrent folder setup shares a mutation and project folders are scoped by parent, workbook and record ID", async () => {
  const f = fixture();
  const roots = await Promise.all([
    f.adapter.ensure("StreamLion", "workspace"),
    f.adapter.ensure("StreamLion", "workspace"),
  ]);
  assert.equal(roots[0].id, roots[1].id);
  assert.equal(f.posts(), 1);
  const parent = roots[0].id;
  const a = await f.adapter.ensure(
    "Same job name",
    "project",
    parent,
    "book-a",
    "project-a",
  );
  const b = await f.adapter.ensure(
    "Same job name",
    "project",
    parent,
    "book-b",
    "project-a",
  );
  const c = await f.adapter.ensure(
    "Repeat visit",
    "project",
    parent,
    "book-a",
    "project-b",
  );
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.equal(
    (
      await f.adapter.ensure(
        "Renamed job",
        "project",
        parent,
        "book-a",
        "project-a",
      )
    ).id,
    a.id,
  );
  assert.equal(f.posts(), 4);
  f.files.get(parent).trashed = true;
  await assert.rejects(
    f.adapter.ensure("New job", "project", parent, "book-a", "project-c"),
    /Choose a Google Drive folder/,
  );
  assert.equal(f.posts(), 4);
});
test("ambiguous folder search and non-writable selections fail without creating or moving files", async () => {
  let posts = 0;
  const adapter = folderAdapter(
    async (path, options = {}) => {
      if (options.method) posts++;
      return new Response(
        JSON.stringify(
          path.includes("?") && path.startsWith("drive/v3/files?")
            ? { files: [{ id: "a" }, { id: "b" }] }
            : {
                id: "read-only",
                mimeType: FOLDER_MIME,
                capabilities: { canAddChildren: false },
              },
        ),
      );
    },
    async () => "reserved",
  );
  await assert.rejects(
    adapter.ensure("StreamLion", "workspace"),
    /More than one/,
  );
  await assert.rejects(adapter.metadata("read-only"), /where you can add/);
  await assert.rejects(adapter.metadata("invalid/id"), /Invalid/);
  assert.equal(posts, 0);
});
