import { handleScheduledCoordination } from "../../server/coordination-scheduled-request.js";
export const onRequest = (context) => handleScheduledCoordination(context);
