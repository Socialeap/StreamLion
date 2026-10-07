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
  if (!req.url.startsWith("/api/api/client-requests")) return next();
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
  const path = req.url.slice("/api/api/client-requests".length);
  try {
    let result;
    if (path === "provider/status")
      result = {
        synthetic: true,
        enabled: true,
        connected: true,
        subject: "synthetic-provider",
        projectMicros: 3000000,
        expiresAt: Date.now() + 365 * 86400000,
        wallet: { available: 7500000 },
      };
    else if (path === "provider/jobs")
      result = { jobs: [job], pending: [], archives: [] };
    else if (path === "client/job")
      result = {
        synthetic: true,
        job: clientView(job),
        brand: "Synthetic provider",
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
