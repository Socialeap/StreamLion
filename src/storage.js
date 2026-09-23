import { openDB } from "idb";
import { assertWorkspace, emptyWorkspace } from "./model.js";
const db = () =>
  openDB("streamlion-local", 1, {
    upgrade(database) {
      database.createObjectStore("workspace");
      database.createObjectStore("audio");
    },
  });
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
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
