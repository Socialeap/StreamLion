import "./landing.css";
import { parseMeasurements } from "./measurements.js";
import { estimateTimeValue } from "./landing-value.js";

const descriptions = {
  prepare: {
    benefit: "Check access before you travel.",
    description: "Keep the brief, contacts and agreed work within reach.",
    area: "Job brief",
  },
  site: {
    benefit: "Leave with readings tied to the room.",
    description: "Dictate, organize and check against your tape.",
    area: "Kitchen",
  },
  handover: {
    benefit: "Know what still needs follow-up.",
    description: "See delivery, acceptance and payment separately.",
    area: "Closeout",
  },
};
function chooseStep(step) {
  if (!Object.hasOwn(descriptions, step)) return;
  document.querySelectorAll(".demo-switch [data-step]").forEach((button) => {
    const active = button.dataset.step === step;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("selected", active);
  });
  document.querySelectorAll("[data-demo-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.demoPanel !== step;
  });
  document.querySelector("#demo-description").textContent =
    descriptions[step].description;
  document.querySelector("#demo-benefit").textContent =
    descriptions[step].benefit;
  document.querySelector("#demo-area").textContent = descriptions[step].area;
}
const minutes = document.querySelector("#roi-minutes");
const rate = document.querySelector("#roi-rate");
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const count = new Intl.NumberFormat("en-US");
function updateValue() {
  const estimate = estimateTimeValue(minutes.value, rate.value);
  document.querySelector("#roi-result").hidden = !estimate;
  document.querySelector("#roi-message").textContent = estimate
    ? ""
    : "Enter minutes above 0 (up to 480) and an hourly value above $0 (up to $10,000).";
  if (!estimate) return;
  document.querySelector("#roi-per-job").textContent =
    estimate.perJob < 0.005 ? "<$0.01" : currency.format(estimate.perJob);
  document.querySelector("#roi-standard").textContent = count.format(
    estimate.standardJobs,
  );
  document.querySelector("#roi-launch").textContent = count.format(
    estimate.launchJobs,
  );
  document.querySelector("#roi-standard-unit").textContent =
    estimate.standardJobs === 1 ? "job" : "jobs";
  document.querySelector("#roi-launch-unit").textContent =
    estimate.launchJobs === 1 ? "job" : "jobs";
  document.querySelector("#roi-standard-bar").style.width =
    `${estimate.standardProgress * 100}%`;
  document.querySelector("#roi-launch-bar").style.width =
    `${estimate.launchProgress * 100}%`;
}
minutes.addEventListener("input", updateValue);
rate.addEventListener("input", updateValue);
updateValue();
const dictation = document.querySelector("#dictation");
function organize() {
  const body = document.querySelector("#readings");
  const issues = document.querySelector("#reading-issues");
  body.replaceChildren();
  issues.replaceChildren();
  try {
    const result = parseMeasurements(dictation.value);
    for (const reading of result.entries) {
      const row = document.createElement("tr");
      for (const value of ["Kitchen", reading.label, reading.display]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
    for (const issue of result.issues) {
      const message = document.createElement("p");
      message.textContent = `Check this wording: ${issue.message}`;
      issues.append(message);
    }
    if (!result.entries.length && !result.issues.length)
      issues.textContent = "Add a reading with a name and units.";
  } catch (error) {
    issues.textContent = error.message;
  }
}
document
  .querySelectorAll("[data-step]")
  .forEach((button) =>
    button.addEventListener("click", () => chooseStep(button.dataset.step)),
  );
document.querySelector("#organize").addEventListener("click", organize);
document.querySelector("#measurement-example").addEventListener("click", () => {
  dictation.value = "Length 12 feet 4 inches. Width 10 feet 2 inches.";
  organize();
});
dictation.addEventListener("input", () => {
  document.querySelector("#readings").replaceChildren();
  document.querySelector("#reading-issues").textContent =
    "Wording changed. Choose Organize readings to check it.";
});
const checks = [...document.querySelectorAll(".sample-checklist input")];
checks.forEach((input) =>
  input.addEventListener("change", () => {
    document.querySelector(".demo-status").textContent =
      `${checks.filter((input) => input.checked).length} of ${checks.length} checks complete in this demo.`;
  }),
);
const closeout = ["delivery", "acceptance", "payment"].map((id) =>
  document.getElementById(id),
);
closeout.forEach((select) =>
  select.addEventListener("change", () => {
    document.querySelector("#closeout-status").textContent =
      `Delivery: ${closeout[0].value} · Acceptance: ${closeout[1].value} · Payment: ${closeout[2].value}`;
  }),
);
const dialog = document.querySelector("#interest-dialog");
document
  .querySelectorAll("[data-interest]")
  .forEach((button) =>
    button.addEventListener("click", () => dialog.showModal()),
  );
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
organize();
