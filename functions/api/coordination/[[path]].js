import { handleCoordination } from "../../../server/client-coordination.js";
import { dispatchNotifications } from "../../../server/coordination-notifications.js";
export async function onRequest(context) {
  const response = await handleCoordination(context);
  if (context.request.method === "POST" && response.ok && context.waitUntil) {
    context.waitUntil(
      dispatchNotifications(context.env, Date.now(), 4).catch(() => {}),
    );
  }
  return response;
}
