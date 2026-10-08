import { createMaintenanceRequest } from "../server/coordination-schedule-auth.js";
export default {
  async scheduled(_event, env) {
    if (env.ENABLE_CLIENT_COORDINATION !== "true") return;
    try {
      const response = await fetch(await createMaintenanceRequest(env));
      const receipt = {
        service: "streamlion-client-coordination",
        status: response.status,
      };
      if (response.ok) {
        const counts = await response.json();
        for (const name of [
          "recovered",
          "archived",
          "reminders",
          "sent",
          "retained",
          "skipped",
          "pushed",
        ])
          if (Number.isInteger(counts[name]) && counts[name] >= 0)
            receipt[name] = counts[name];
      }
      console.log(JSON.stringify(receipt));
    } catch {
      console.log(
        JSON.stringify({
          service: "streamlion-client-coordination",
          status: "awaiting-configuration-or-retry",
        }),
      );
    }
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
