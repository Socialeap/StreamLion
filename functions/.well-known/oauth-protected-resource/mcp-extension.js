import { extensionMetadata } from "../../../server/extension-auth.js";
export const onRequest = ({ request, env }) =>
  extensionMetadata(request, env, "resource");
