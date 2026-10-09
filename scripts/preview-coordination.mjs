// Local synthetic UI preview. No Google, mail, Stripe or AI calls.
import { createServer } from "vite";
import {
  newClientJob,
  reduceClientJob,
  clientView,
} from "../src/client-workflow.js";
import {
  INTAKE_PRESETS,
  TM_CAPTURE_PRESET,
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
const links = new Map(),
  publicForms = new Map();
let prospectVerified = true,
  claim = null;
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
  if (
    ["/api/purchase/status", "/api/google/session"].includes(
      req.url.split("?")[0],
    )
  ) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify(
        req.url.startsWith("/api/purchase/")
          ? { enabled: false, required: false, purchased: false }
          : { enabled: true, connected: false },
      ),
    );
    return;
  }
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
        shareLinks: true,
        publicForms: true,
      };
    else if (path === "provider/jobs")
      result = {
        jobs: [job],
        links: [...links.values()],
        forms: [...publicForms.values()],
        templates: [...templates.values()],
        pending: [],
        archives: [],
        activity: [
          {
            id: "sample-event",
            jobId: job.id,
            at: job.updatedAt,
            revision: job.revision,
            label: job.submittedAt ? "Request submitted" : "Request created",
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
        prospect: data.shareLink === true || data.publicForm === true,
        contactName: data.contactName,
        companyName: data.companyName,
        now: Date.now(),
        intakeTemplate:
          data.preset === "tm-spatial"
            ? reviseIntakeTemplate(
                null,
                {
                  id: "intake-tm-spatial",
                  provider: "synthetic-provider",
                  expectedVersion: 0,
                  config: TM_CAPTURE_PRESET,
                },
                Date.now(),
              )
            : data.template
              ? selectedIntakeTemplate(
                  { events: templateEvents },
                  data.template,
                  "synthetic-provider",
                )
              : null,
      });
      if (data.publicForm) {
        const form = {
          id: "form-" + data.operation,
          brand: "Synthetic provider",
          intake: job.intake,
          active: true,
          verificationRequired: data.verificationRequired === true,
          url:
            `http://127.0.0.1:${process.env.STREAMLION_QA_PORT || 5175}/api/client-portal#form=` +
            "P".repeat(43),
        };
        publicForms.set(form.id, form);
        result = { form };
      } else {
        const url =
          `http://127.0.0.1:${process.env.STREAMLION_QA_PORT || 5175}/api/client-portal?job=${job.id}` +
          (data.shareLink ? "#invite=" + "S".repeat(43) : "");
        if (data.shareLink) {
          links.set(job.id, {
            jobId: job.id,
            url,
            openedAt: null,
            claimedAt: null,
            expiresAt: Date.now() + 30 * 86400000,
          });
          prospectVerified = false;
        }
        result = { jobId: job.id, url, shareLink: data.shareLink };
      }
    } else if (path === "provider/form") {
      const data = JSON.parse(body),
        form = publicForms.get(data.formId);
      form.active = data.active;
      form.verificationRequired = data.verificationRequired;
      result = { updated: true };
    } else if (path === "public/open") {
      const form = [...publicForms.values()].at(-1);
      result = { ...form, reusable: true };
    } else if (path === "public/submit") {
      const data = JSON.parse(body),
        form = [...publicForms.values()].at(-1),
        now = Date.now();
      job = newClientJob({
        id: "job-public-" + data.operation,
        provider: "synthetic-provider",
        clientEmail: data.email || "",
        title: data.fields.title || "",
        prospect: true,
        now,
      });
      job.fields = { ...job.fields, ...data.fields };
      job.state = "submitted";
      job.submittedAt = now;
      job.openedAt = now;
      job.intake = form.intake;
      job.source = "public-form";
      job.emailVerified = false;
      job.requestExpiresAt = now + 30 * 86400000;
      prospectVerified = true;
      result = {
        jobId: job.id,
        url: `http://127.0.0.1:${process.env.STREAMLION_QA_PORT || 5175}/api/client-portal?job=${job.id}#access=${data.accessToken}`,
        expiresAt: job.requestExpiresAt,
        message: "Request submitted. Save your private status link.",
      };
    } else if (path === "client/access") {
      prospectVerified = true;
      result = { opened: true };
    } else if (path === "prospect/open") {
      const link = links.get(job.id);
      link.openedAt ||= Date.now();
      templateRevision++;
      result = {
        jobId: job.id,
        brand: "Synthetic provider",
        intake: job.intake,
        expiresAt: link.expiresAt,
      };
    } else if (path === "prospect/request") {
      const data = JSON.parse(body);
      claim = data;
      result = {
        message:
          "Synthetic verification ready. Open the local verification link; no email was sent.",
      };
    } else if (path === "client/verify" && claim) {
      const { captureEstimate } = await import("../src/capture-estimate.js");
      job = reduceClientJob(
        job,
        {
          action: "claim_request",
          expectedRevision: job.revision,
          email: claim.email,
          fields: claim.fields,
          openedAt: links.get(job.id).openedAt,
          estimate: captureEstimate(
            job.intake?.estimateProfile,
            claim.fields.propertySizeSqFt,
            claim.creative,
          ),
        },
        { role: "system" },
        Date.now(),
      );
      const link = links.get(job.id);
      link.claimedAt = Date.now();
      link.url = null;
      prospectVerified = true;
      result = { verified: true };
    } else if (path === "client/job") {
      if (!prospectVerified) {
        res.statusCode = 401;
        res.end(
          JSON.stringify({ error: "Verify your email to open this project." }),
        );
        return;
      }
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
    } else if (path === "provider/revoke-link") {
      links.get(job.id).url = null;
      links.get(job.id).revoked = true;
      result = { revoked: true };
    } else if (path.endsWith("/command")) {
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
          templateRevision +
          "-" +
          JSON.stringify(
            [...links.values()].map((l) => [
              l.jobId,
              l.openedAt || 0,
              l.claimedAt || 0,
              l.revoked || false,
            ]),
          ),
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
