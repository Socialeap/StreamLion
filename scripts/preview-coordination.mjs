// Local synthetic UI preview. No Google, mail, Stripe or AI calls.
import { createServer } from "vite";
import {
  newClientJob,
  reduceClientJob,
  clientView,
} from "../src/client-workflow.js";
let job = newClientJob({
  id: "job-synthetic",
  provider: "synthetic-provider",
  clientEmail: "synthetic@example.com",
  title: "Harbor Office · sample request",
  now: Date.now(),
});
job = reduceClientJob(
  job,
  {
    action: "edit",
    expectedRevision: 0,
    fields: {
      address: "100 Example Street",
      city: "Sample City",
      scope: "Capture the lobby, two office suites and connecting corridors.",
      exclusions: "Occupied storage rooms.",
      deliverables: "3D tour, floor plan and completion checklist.",
      accessInstructions: "Meet the building contact at the lobby.",
      requesterName: "Sample Client",
      proposedTimes: "Tuesday morning or Thursday afternoon.",
    },
  },
  { role: "client" },
  Date.now(),
);
job = reduceClientJob(
  job,
  { action: "submit", expectedRevision: job.revision },
  { role: "client" },
  Date.now(),
);
const handler = async (req, res, next) => {
  if (!req.url.startsWith("/api/coordination/")) return next();
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 800000) {
      res.statusCode = 413;
      res.end();
      return;
    }
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "http://127.0.0.1");
  const path = url.pathname.slice("/api/coordination/".length);
  try {
    let result;
    if (path.endsWith("/notifications"))
      result = { enabled: false, devices: [] };
    else if (path === "provider/status")
      result = {
        synthetic: true,
        enabled: true,
        connected: true,
        subject: "synthetic-provider",
        projectMicros: 3000000,
        expiresAt: Date.now() + 365 * 86400000,
        wallet: { available: 7500000 },
        delivery: { email: false, push: false },
      };
    else if (path === "provider/jobs")
      result = {
        jobs: [job],
        pending: [],
        archives: [],
        activity: [
          {
            id: "sample-event",
            jobId: job.id,
            at: job.updatedAt,
            revision: job.revision,
            label: "Request submitted",
          },
        ],
      };
    else if (path === "client/job")
      result = {
        synthetic: true,
        job: clientView(job),
        brand: "Synthetic provider",
        activity: [
          {
            id: "sample-event",
            jobId: job.id,
            at: job.updatedAt,
            revision: job.revision,
            label: "Request submitted",
          },
        ],
      };
    else if (path.endsWith("/command")) {
      const data = JSON.parse(body),
        role = path.startsWith("client") ? "client" : "provider";
      job = reduceClientJob(
        job,
        { ...data.command, id: data.operation },
        { role },
        Date.now(),
      );
      if (job.state === "activation_pending")
        job = reduceClientJob(
          job,
          { action: "activate", expectedRevision: job.revision },
          { role: "system" },
          Date.now(),
        );
      result = { complete: true };
    } else {
      res.statusCode = 400;
      result = { error: "This action is outside the synthetic preview." };
    }
    if (["provider/jobs", "client/job"].includes(path)) {
      const refresh = {
        token: "synthetic-" + path.replace("/", "-") + "-" + job.revision,
        verifiedAt: Date.now(),
        pollAfterMs: 15000,
        reconcileAfterMs: 60000,
      };
      result =
        url.searchParams.get("refresh") === refresh.token
          ? { unchanged: true, refresh }
          : { ...result, refresh };
    }
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error.status || 400;
    res.end(JSON.stringify({ error: error.message }));
  }
};
const server = await createServer({
  server: { host: "127.0.0.1", port: 5175, strictPort: true },
  plugins: [
    {
      name: "synthetic-coordination",
      configureServer(server) {
        server.middlewares.use(handler);
      },
    },
  ],
});
await server.listen();
console.log("Synthetic provider: http://127.0.0.1:5175/api/client-requests");
console.log(
  "Synthetic client: http://127.0.0.1:5175/api/client-portal?job=job-synthetic",
);
