import "./landing.css";
import { parseMeasurements } from "./measurements.js";

const descriptions = {
  prepare: "Check the brief and the agreed work before you head out.",
  site: "See how a site measurement fits together, from dictation to a checked reading.",
  handover:
    "Keep delivery, client acceptance and payment separate, so the next action is clear.",
};
function chooseStep(step) {
  if (!Object.hasOwn(descriptions, step)) return;
  document.querySelectorAll("[data-step]").forEach((button) => {
    const active = button.dataset.step === step;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("selected", active);
  });
  document.querySelectorAll("[data-hero-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.heroPanel !== step;
  });
  document.querySelectorAll("[data-demo-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.demoPanel !== step;
  });
  document.querySelector("#demo-description").textContent = descriptions[step];
}
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
