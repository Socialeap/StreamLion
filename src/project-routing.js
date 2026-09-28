import { toLocalProject } from "./workbook.js";

export function visibleProjects(remote, deviceProjects) {
  const googleProjects = remote ? remote.Projects.map(toLocalProject) : [];
  const googleIds = new Set(googleProjects.map((project) => project.id));
  const deviceOnly = deviceProjects
    .filter((project) => !googleIds.has(project.id))
    .map((project) => ({ ...project, deviceOnly: true }));
  return remote ? [...googleProjects, ...deviceOnly] : deviceOnly;
}

export function assertSaveDestination(bookId, remote) {
  if (bookId && !remote)
    throw new Error(
      "Reconnect Google in Connections before saving to your selected workbook. Your draft is still on this device.",
    );
}
