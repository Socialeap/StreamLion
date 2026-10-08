import { newClientJob, reduceClientJob } from "./client-workflow.js";

export function sampleRequest(title = "Harbor House") {
  return newClientJob({
    id: "sample-work-order",
    provider: "sample-provider",
    clientEmail: "client@example.com",
    title,
    now: 1,
  });
}
export function sampleCommand(job, role, action, extra = {}) {
  const next = reduceClientJob(
    job,
    { action, expectedRevision: job.revision, ...extra },
    { role },
    job.revision + 2,
  );
  return next.state === "activation_pending"
    ? reduceClientJob(
        next,
        { action: "activate", expectedRevision: next.revision },
        { role: "system" },
        next.revision + 2,
      )
    : next;
}
export function coordinationAvailability(data) {
  if (
    data?.enabled === true &&
    data.public === false &&
    data.status === "delivery_paused"
  )
    return "Client invitations are temporarily unavailable. Explore the sample workflow below.";
  if (
    data?.enabled === true &&
    data.public === true &&
    data.status === "available"
  )
    return "Client coordination is available to eligible Core providers. Clients use the portal free.";
  if (
    data?.enabled === true &&
    data.public === false &&
    data.status === "pilot"
  )
    return "Client coordination is in restricted testing. Public availability will be shown here.";
  return "Client coordination is currently unavailable. Explore the sample workflow below.";
}
export function initializeCoordinationSample(root = document) {
  const form = root.querySelector("#sample-invitation");
  if (!form) return;
  let job = sampleRequest(),
    role = "provider";
  const status = root.querySelector("#sample-coordination-status");
  const approve = root.querySelector("#sample-approve");
  const agreement = root.querySelector("#sample-agreement");
  function render() {
    root
      .querySelectorAll("[data-coordination-role]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.coordinationRole === role),
        ),
      );
    root
      .querySelectorAll("[data-coordination-panel]")
      .forEach(
        (panel) =>
          (panel.hidden =
            panel.dataset.coordinationPanel !== role || Boolean(job.accepted)),
      );
    root.querySelector("#sample-request-title").textContent =
      `${job.fields.title} · sample request`;
    agreement.hidden = job.state === "draft";
    root.querySelector("#sample-agreed-scope").textContent =
      job.fields.scope || "";
    const approved =
      role === "provider" ? job.providerApproved : job.clientApproved;
    approve.disabled =
      job.state === "closed" ||
      (approved && !job.accepted) ||
      (role === "client" && job.accepted && job.state !== "delivered") ||
      (role === "client" && job.deliveryAccepted);
    approve.textContent = !job.accepted
      ? `Approve as ${role}`
      : role === "provider"
        ? "Preview delivery"
        : "Acknowledge sample delivery";
    if (job.accepted && role === "provider" && job.state === "delivered")
      approve.disabled = true;
  }
  root.querySelectorAll("[data-coordination-role]").forEach((button) =>
    button.addEventListener("click", () => {
      role = button.dataset.coordinationRole;
      render();
    }),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    job = sampleRequest(
      root.querySelector("#sample-project-name").value.trim(),
    );
    root.querySelector("#sample-project-link").textContent =
      `Sample invitation for ${root.querySelector("#sample-client-email").value}. A real link is restricted to the invited email.`;
    status.textContent =
      "Invitation preview ready. Choose Client to complete the sample work order. No email was sent.";
    render();
  });
  root
    .querySelector("#sample-client-brief")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        job = sampleCommand(job, "client", "edit", {
          fields: {
            address: root.querySelector("#sample-address").value,
            scope: root.querySelector("#sample-scope").value,
            accessInstructions: root.querySelector("#sample-access").value,
            deliverables: "3D tour and completion checklist.",
          },
        });
        job = sampleCommand(job, "client", "submit");
        status.textContent =
          "Sample brief submitted. Approve it as each role to see mutual agreement. No job credits are used in this sample.";
        render();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  approve.addEventListener("click", () => {
    try {
      job = sampleCommand(
        job,
        role,
        !job.accepted
          ? "approve"
          : role === "provider"
            ? "progress"
            : "accept_delivery",
        role === "provider" && job.accepted ? { state: "delivered" } : {},
      );
      status.textContent = job.deliveryAccepted
        ? "Sample delivery acknowledged. Both sides share the same work order. No records were saved or credits used."
        : job.state === "delivered"
          ? "Sample delivery recorded. Choose Client to acknowledge it."
          : job.accepted
            ? "Sample scope approved by both sides. Real jobs activate only after the displayed charge is authorized."
            : `Sample approved by ${role}. The other party still needs to approve.`;
      render();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  render();
}
