export const FOLDER_MIME = "application/vnd.google-apps.folder";
const ID = /^[\w-]{1,100}$/;
export function folderLink(id) {
  return ID.test(id || "")
    ? `https://drive.google.com/drive/folders/${id}`
    : "";
}
export function folderAdapter(drive, reserveId) {
  const pending = new Map(),
    reserved = new Map();
  async function metadata(id) {
    if (!ID.test(id || "")) throw new Error("Invalid folder selection.");
    const response = await drive(
      `drive/v3/files/${id}?fields=id,name,mimeType,trashed,parents,appProperties,capabilities(canAddChildren)`,
    );
    if (!response.ok)
      throw new Error(
        "Your saved folder is unavailable. Choose it again in Connections; your records are kept.",
      );
    const file = await response.json();
    if (
      file.id !== id ||
      file.trashed ||
      file.mimeType !== FOLDER_MIME ||
      !file.capabilities?.canAddChildren
    )
      throw new Error("Choose a Google Drive folder where you can add files.");
    return file;
  }
  async function ensure(name, role, parent = "", book = "", project = "") {
    if ([parent, book, project].some((id) => id && !ID.test(id)))
      throw new Error("Invalid project folder destination.");
    const key = JSON.stringify([role, parent, book, project]);
    if (pending.has(key)) return pending.get(key);
    const task = async () => {
      if (parent) await metadata(parent);
      const properties = {
        streamlionRole: role,
        ...(book && { streamlionBook: book }),
        ...(project && { streamlionProject: project }),
      };
      const q = [
        "trashed = false",
        `mimeType = '${FOLDER_MIME}'`,
        ...(parent ? [`'${parent}' in parents`] : []),
        ...Object.entries(properties).map(
          ([k, v]) => `appProperties has { key='${k}' and value='${v}' }`,
        ),
      ].join(" and ");
      const response = await drive(
        "drive/v3/files?" +
          new URLSearchParams({
            q,
            spaces: "drive",
            pageSize: "2",
            fields: "files(id),nextPageToken,incompleteSearch",
          }),
      );
      if (!response.ok)
        throw new Error("Could not check your StreamLion folders. Try again.");
      const result = await response.json();
      if (
        !Array.isArray(result.files) ||
        result.incompleteSearch ||
        result.nextPageToken ||
        result.files.length > 1
      )
        throw new Error(
          "More than one matching folder, or an incomplete search. Choose your main folder in Connections or contact support for project folders.",
        );
      if (result.files.length) {
        const file = await metadata(result.files[0].id);
        if (
          Object.entries(properties).some(
            ([k, v]) => file.appProperties?.[k] !== v,
          ) ||
          (parent && !file.parents?.includes(parent))
        )
          throw new Error("Project folder changed. Retry before adding files.");
        return file;
      }
      // Reserve an ID before the mutation and retain it on failed acknowledgement.
      // Concurrent calls in this app share one operation; never retry a POST blindly.
      if (!reserved.has(key)) reserved.set(key, await reserveId());
      const id = reserved.get(key);
      const created = await drive("drive/v3/files?fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: name.slice(0, 180),
          mimeType: FOLDER_MIME,
          ...(parent && { parents: [parent] }),
          appProperties: properties,
        }),
      });
      if (!created.ok && created.status !== 409)
        throw new Error(
          "Folder creation has not been confirmed. Retry; your project is kept.",
        );
      const file = await metadata(id);
      if (
        Object.entries(properties).some(
          ([k, v]) => file.appProperties?.[k] !== v,
        ) ||
        (parent && !file.parents?.includes(parent))
      )
        throw new Error(
          "The folder does not match this project. Contact support before adding files.",
        );
      reserved.delete(key);
      return file;
    };
    const promise = globalThis.navigator?.locks
      ? navigator.locks.request(`streamlion-folder:${key}`, task)
      : task();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }
  return { metadata, ensure };
}
