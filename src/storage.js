import { openDB } from "idb";
import { assertWorkspace, emptyWorkspace } from "./model.js";
import { TABS, validateRevision } from "./workbook.js";
const db = () =>
  openDB("streamlion-local", 1, {
    upgrade(database) {
      database.createObjectStore("workspace");
      database.createObjectStore("audio");
    },
  });
export const openLocalDatabase = db;
export async function loadWorkspace() {
  return assertWorkspace(
    (await (await db()).get("workspace", "current")) || emptyWorkspace(),
  );
}
async function commit(data, audio) {
  const database = await db();
  const tx = database.transaction(
    audio ? ["workspace", "audio"] : ["workspace"],
    "readwrite",
  );
  // Handle transaction rejection even if a request throws before awaiting done.
  const done = tx.done.catch((error) => ({ error }));
  const store = tx.objectStore("workspace");
  const previous = await store.get("current");
  if ((previous?.revision || 0) !== data.revision - 1) {
    tx.abort();
    await done;
    throw new Error(
      "This workspace changed in another tab. Copy your draft, then reload before saving.",
    );
  }
  await store.put(data, "current");
  if (audio) await tx.objectStore("audio").put(audio.blob, audio.id);
  const result = await done;
  if (result?.error) throw result.error;
}
export const saveWorkspace = (data) => commit(data);
export const saveAudioNote = (data, id, blob) => commit(data, { id, blob });
export async function getAudio(id) {
  return (await db()).get("audio", id);
}
export async function loadSiteCopy(bookId) {
  if (!bookId) return null;
  const saved = await (await db()).get("workspace", `site-copy:${bookId}`);
  if (!saved) return null;
  if (
    saved.version !== 1 ||
    saved.bookId !== bookId ||
    !Number.isFinite(Date.parse(saved.verifiedAt))
  )
    throw new Error(
      "The site copy could not be read. Reconnect Google to replace it.",
    );
  for (const [tab, headers] of Object.entries(TABS)) {
    if (!Array.isArray(saved.data?.[tab]))
      throw new Error("The site copy is incomplete. Reconnect Google.");
    saved.data[tab].forEach((record) => validateRevision(record, headers));
  }
  return saved;
}
export async function saveSiteCopy(bookId, data) {
  // Deliberately retain only verified record heads, never tokens or config.
  const cleanData = Object.fromEntries(
    Object.entries(TABS).map(([tab, headers]) => {
      if (!Array.isArray(data?.[tab]))
        throw new Error("The workbook copy is incomplete.");
      return [
        tab,
        data[tab].map((record) => {
          validateRevision(record, headers);
          return Object.fromEntries(
            headers.map((name) => [name, record[name] ?? ""]),
          );
        }),
      ];
    }),
  );
  const copy = {
    version: 1,
    bookId,
    verifiedAt: new Date().toISOString(),
    data: cleanData,
  };
  if (JSON.stringify(copy).length > 20000000)
    throw new Error(
      "This workbook is too large for a site copy on this device.",
    );
  await (await db()).put("workspace", copy, `site-copy:${bookId}`);
  return copy;
}
export async function removeSiteCopy(bookId) {
  await (await db()).delete("workspace", `site-copy:${bookId}`);
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
