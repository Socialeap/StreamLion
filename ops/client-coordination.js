import { maintainCoordination } from "../server/coordination-maintenance.js";
export default {
  async scheduled(_event, env) {
    const counts = await maintainCoordination(env);
    console.log(
      JSON.stringify({ service: "streamlion-client-coordination", ...counts }),
    );
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
