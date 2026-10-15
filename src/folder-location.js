import { FOLDER_MIME, folderLink } from "./drive-folders.js";
const ID = /^[\w-]{1,100}$/;

// Read only the selected folder and a bounded ancestor chain. A missing ancestor
// under drive.file access must never be presented as a complete Drive path.
export async function folderLocation(drive, id) {
  if (!ID.test(id || "")) throw new Error("Invalid folder selection.");
  async function metadata(fileId) {
    const response = await drive(
      `drive/v3/files/${fileId}?fields=id,name,mimeType,trashed,parents,driveId&supportsAllDrives=true`,
    );
    if (!response.ok) throw new Error("Folder details unavailable.");
    const file = await response.json();
    if (
      !ID.test(file?.id || "") ||
      (fileId !== "root" && file.id !== fileId) ||
      typeof file.name !== "string" ||
      !file.name.trim() ||
      file.trashed ||
      file.mimeType !== FOLDER_MIME ||
      (file.parents != null &&
        (!Array.isArray(file.parents) ||
          file.parents.length > 1 ||
          file.parents.some((p) => !ID.test(p))))
    )
      throw new Error("Folder details unavailable.");
    return file;
  }
  const folder = await metadata(id);
  let root = null;
  if (!folder.driveId) {
    try {
      root = await metadata("root");
    } catch {
      /* Ancestors may be outside the granted scope. */
    }
  }
  let current = folder,
    complete = false;
  const names = [folder.name],
    seen = new Set([id]);
  for (let depth = 0; depth < 12; depth++) {
    if (current.id === root?.id || current.id === folder.driveId) break;
    const parentId = current.parents?.[0];
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    try {
      current = parentId === root?.id ? root : await metadata(parentId);
    } catch {
      break;
    }
    names.unshift(current.name);
  }
  // The final allowed parent may itself be the root. Classify it after
  // traversal, without spending another ancestor read or extending the bound.
  if (current.id === root?.id) {
    names[0] = "My Drive";
    complete = true;
  } else if (current.id === folder.driveId) {
    names.unshift("Shared drives");
    complete = true;
  }
  return {
    id,
    name: folder.name,
    location: names.join(" / "),
    complete,
    url: folderLink(id),
  };
}
