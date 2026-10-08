// Local synthetic UI preview. No Google, mail, Stripe or AI calls.
import { createServer } from "vite";
import {
  newClientJob,
  reduceClientJob,
  clientView,
} from "../src/client-workflow.js";
import {
  INTAKE_PRESETS,
  reviseIntakeTemplate,
  selectedIntakeTemplate,
} from "../src/intake-templates.js";
import { archiveImportRecords } from "../server/coordination-archive.js";
import {
  archiveFixture,
  archiveEnv,
  archiveSource,
} from "../test/archive-fixture.js";
const sampleArchive = await archiveFixture(archiveEnv, {
  ...archiveSource,
  google_subject: "synthetic-provider",
});
const recovered = new Map();
const templates = new Map(),
  templateEvents = new Map();
let templateRevision = 0;
const initialTemplate = reviseIntakeTemplate(
  null,
  {
    id: "intake-synthetic",
    provider: "synthetic-provider",
    expectedVersion: 0,
    config: INTAKE_PRESETS[0],
  },
  Date.now(),
);
templates.set(initialTemplate.id, initialTemplate);
templateEvents.set("initial-template", {
  jobId: initialTemplate.id,
  revision: 0,
  job: initialTemplate,
});
let job = newClientJob({
  id: "job-synthetic",
  provider: "synthetic-provider",
  clientEmail: "synthetic@example.com",
  title: "Harbor Office · sample request",
  now: Date.now(),
  intakeTemplate: initialTemplate,
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
    if (path === "availability")
      result = { enabled: true, public: false, status: "pilot" };
    else if (path.endsWith("/notifications"))
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
        delivery: { email: true, push: false },
      };
    else if (path === "provider/jobs")
      result = {
        jobs: [job],
        templates: [...templates.values()],
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
    else if (path === "provider/template") {
      const data = JSON.parse(body);
      const record = reviseIntakeTemplate(
        templates.get(data.templateId),
        {
          id: data.templateId,
          provider: "synthetic-provider",
          expectedVersion: data.expectedVersion,
          config: data.config,
        },
        Date.now(),
      );
      templates.set(record.id, record);
      templateEvents.set(data.operation, {
        jobId: record.id,
        revision: record.revision,
        job: record,
      });
      templateRevision++;
      result = { complete: true };
    } else if (path === "provider/archive-restore") {
      const data = JSON.parse(body);
      if (data.fileId !== "synthetic-archive")
        throw new Error("Use synthetic-archive for this local preview.");
      if (!recovered.has(data.operation)) {
        job = archiveImportRecords(
          sampleArchive,
          data.operation,
          Date.now(),
        ).job;
        recovered.set(data.operation, {
          complete: true,
          jobId: job.id,
          archived: true,
        });
      }
      result = recovered.get(data.operation);
    } else if (path === "provider/create") {
      const data = JSON.parse(body);
      job = newClientJob({
        id: "job-" + data.operation,
        provider: "synthetic-provider",
        clientEmail: data.email,
        title: data.title,
        now: Date.now(),
        intakeTemplate: data.template
          ? selectedIntakeTemplate(
              { events: templateEvents },
              data.template,
              "synthetic-provider",
            )
          : null,
      });
      result = {
        jobId: job.id,
        url: `http://127.0.0.1:${process.env.STREAMLION_QA_PORT || 5175}/api/client-portal?job=${job.id}`,
      };
    } else if (path === "client/job")
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
        token:
          "synthetic-" +
          path.replace("/", "-") +
          "-" +
          job.id +
          "-" +
          job.revision +
          "-" +
          templateRevision,
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
    res.end(
      JSON.stringify({
        error: error.message,
        ...(error.code === "invalid_project_fields"
          ? { code: error.code }
          : {}),
      }),
    );
  }
};
const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.STREAMLION_QA_PORT || 5175),
    strictPort: true,
  },
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
console.log(
  `Synthetic provider: http://127.0.0.1:${process.env.STREAMLION_QA_PORT || 5175}/api/client-requests`,
);
console.log(
  `Synthetic client: http://127.0.0.1:${process.env.STREAMLION_QA_PORT || 5175}/api/client-portal?job=job-synthetic`,
);
