import "./landing.css";
import { parseMeasurements } from "./measurements.js";
import { estimateTaskValue, VALUE_TASKS } from "./landing-value.js";
import { answerProjectQuestion } from "./project-answers.js";
import { beforeLeaving } from "./workflow.js";
import {
  closeoutNextActions,
  checklistFromJobDetails,
} from "./landing-demo.js";

const descriptions = {
  prepare: {
    benefit: "Turn the agreed work into checks you can act on.",
    description:
      "Change the sample brief. Build a checklist. See exactly what is still open before you leave.",
    area: "Job brief",
  },
  site: {
    benefit: "Leave with readings tied to the room.",
    description:
      "Name a space, dictate the readings, and see them organized for your tape check.",
    area: "Room readings",
  },
  handover: {
    benefit: "Know which follow-up comes next.",
    description:
      "Change the delivery, acceptance or payment record. See which follow-up comes next and why.",
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
document
  .querySelectorAll("[data-step]")
  .forEach((button) =>
    button.addEventListener("click", () => chooseStep(button.dataset.step)),
  );
const heroButtons = [...document.querySelectorAll("[data-hero]")];
heroButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    heroButtons.forEach((item) =>
      item.setAttribute("aria-pressed", String(item === button)),
    );
    document.querySelectorAll("[data-hero-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.heroPanel !== button.dataset.hero;
    });
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? heroButtons.length - 1
          : (index +
              (event.key === "ArrowLeft" ? -1 : 1) +
              heroButtons.length) %
            heroButtons.length;
    heroButtons[target].focus();
    heroButtons[target].click();
  });
});
const rate = document.querySelector("#roi-rate");
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
let purchasePrices;
function updateValue() {
  const tasks = VALUE_TASKS.map((id) => ({
    before: document.querySelector(`#time-${id}-before`).value,
    after: document.querySelector(`#time-${id}-after`).value,
  }));
  const estimate = estimateTaskValue(tasks, rate.value, purchasePrices);
  document.querySelector("#roi-result").hidden = !estimate?.value;
  document.querySelector("#roi-message").textContent = estimate
    ? ""
    : "Enter a timing from 0 to 480 minutes in every box (each column totals up to 480), and an hourly value above $0, up to $10,000.";
  document.querySelector("#roi-time-summary").textContent = estimate
    ? `${count.format(estimate.before)} min today → ${count.format(estimate.after)} min organized. ${
        estimate.minutes > 0
          ? `${count.format(estimate.minutes)} minutes freed in this scenario.`
          : estimate.minutes === 0
            ? "These timings show no time difference."
            : `${count.format(-estimate.minutes)} more minutes in the organized scenario. Revisit the task timings to see where the extra work comes from.`
      }`
    : "";
  const value = estimate?.value;
  if (!value) return;
  document.querySelector("#roi-per-job").textContent =
    value.perJob < 0.005 ? "<$0.01" : currency.format(value.perJob);
  for (const name of ["standard", "launch"]) {
    document.querySelector(`#roi-${name}`).textContent = count.format(
      value[`${name}Jobs`],
    );
    document.querySelector(`#roi-${name}-unit`).textContent =
      value[`${name}Jobs`] === 1 ? "job" : "jobs";
    document.querySelector(`#roi-${name}-bar`).style.width =
      `${value[`${name}Progress`] * 100}%`;
  }
}
document
  .querySelectorAll(".task-timings input, #roi-rate")
  .forEach((input) => input.addEventListener("input", updateValue));
updateValue();

const brief = document.querySelector("#demo-brief");
const requiredReadings = document.querySelector("#demo-required-readings");
let checklistProject, checklistPlan;
function updateChecklist() {
  const remaining = beforeLeaving(checklistProject, checklistPlan, []);
  const list = document.querySelector("#checklist-remaining");
  list.replaceChildren();
  if (remaining.length === checklistPlan.requirements.length) {
    document.querySelector(".demo-status").textContent =
      `${remaining.length} job-specific checks built. Tick completed work to reveal what is still open.`;
    return;
  }
  document.querySelector(".demo-status").textContent = remaining.length
    ? `${remaining.length} ${remaining.length === 1 ? "check" : "checks"} still open before leaving job-site:`
    : "Job-site checks complete. Next: gather your evidence for the handover.";
  remaining.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.label;
    list.append(li);
  });
}
function buildChecklist() {
  const holder = document.querySelector("#checklist-items");
  try {
    const { project, plan, spaces, readings } = checklistFromJobDetails(
      brief.value,
      requiredReadings.value,
    );
    checklistProject = project;
    checklistPlan = plan;
    document.querySelector("#demo-spaces-summary").textContent =
      spaces.join(" · ") || "None stated in this example";
    document.querySelector("#demo-readings-summary").textContent =
      readings.join(" · ") || "None stated in this example";
    holder.replaceChildren();
    plan.requirements.forEach((item) => {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", () => {
        item.state = input.checked ? "done" : "todo";
        updateChecklist();
      });
      label.append(input, document.createTextNode(item.label));
      holder.append(label);
    });
    updateChecklist();
  } catch (error) {
    holder.replaceChildren();
    document.querySelector("#checklist-remaining").replaceChildren();
    document.querySelector(".demo-status").textContent = error.message;
  }
}
[brief, requiredReadings].forEach((input) =>
  input.addEventListener("input", () => {
    document.querySelectorAll("#checklist-items input").forEach((input) => {
      input.disabled = true;
    });
    document.querySelector("#checklist-remaining").replaceChildren();
    document.querySelector(".demo-status").textContent =
      "Agreed work changed. Build the checklist again to check the new requirements.";
  }),
);
document
  .querySelector("#build-checklist")
  .addEventListener("click", buildChecklist);
buildChecklist();

const dictation = document.querySelector("#dictation");
const space = document.querySelector("#measurement-space");
function organize() {
  const body = document.querySelector("#readings"),
    issues = document.querySelector("#reading-issues");
  body.replaceChildren();
  issues.replaceChildren();
  if (!space.value.trim()) {
    issues.textContent =
      "Name the room or space so these readings stay with the right area.";
    space.focus();
    return;
  }
  try {
    const result = parseMeasurements(dictation.value);
    for (const reading of result.entries) {
      const row = document.createElement("tr");
      for (const value of [
        space.value.trim(),
        reading.label,
        reading.display,
      ]) {
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
document.querySelector("#organize").addEventListener("click", organize);
document.querySelector("#measurement-example").addEventListener("click", () => {
  space.value = "Kitchen";
  dictation.value = "Length 12 feet 4 inches. Width 10 feet 2 inches.";
  organize();
});
[dictation, space].forEach((input) =>
  input.addEventListener("input", () => {
    document.querySelector("#readings").replaceChildren();
    document.querySelector("#reading-issues").textContent =
      "Input changed. Choose Organize readings to check it.";
  }),
);
organize();

const closeout = ["delivery", "acceptance", "payment"].map((id) =>
  document.getElementById(id),
);
function updateCloseout() {
  const result = closeoutNextActions(
    ...closeout.map((select) => select.value),
    {
      invoiceAmount: "300",
      paidAmount: closeout[2].selectedOptions[0].dataset.amount || "",
      currency: "USD",
    },
  );
  document.querySelector("#closeout-status").textContent = result.headline;
  document.querySelector("#closeout-balance").textContent =
    result.outstanding === "Not enough information"
      ? "Invoice balance: payment amount not recorded."
      : `Invoice balance: ${result.outstanding}`;
  const list = document.querySelector("#closeout-actions");
  list.replaceChildren();
  result.actions.forEach((action) => {
    const li = document.createElement("li"),
      title = document.createElement("strong"),
      detail = document.createElement("p");
    title.textContent = action.label;
    detail.textContent = action.detail;
    li.append(title, detail);
    list.append(li);
  });
  document.querySelector("#closeout-reason").textContent = result.reason;
}
closeout.forEach((select) => select.addEventListener("change", updateCloseout));
updateCloseout();

// Synthetic preview uses the same bounded lookup as the actual workspace.
// It never opens a microphone or connects to a visitor's Google account.
const sampleProject = {
  id: "landing-harbor-house",
  title: "Harbor House",
  contact1Name: "Alex Morgan",
  contact1Phone: "+1 202 555 0148",
  accessInstructions: "Meet Alex at the front entrance. Call on arrival.",
  deliverables: "Tour link, site notes and checked measurements.",
  deliveryDestination: "Send the handover to the commissioning company.",
};
const sampleQuestions = {
  contact: "Who is the site contact?",
  access: "How do I get in?",
  outputs: "What are the deliverables?",
};
let sampleTopic = "contact";
let sampleUtterance = null;
const readButton = document.querySelector("#voice-demo-read");
const sampleStatus = document.querySelector("#voice-demo-status");
const canReadSample = Boolean(
  window.speechSynthesis && window.SpeechSynthesisUtterance,
);
function stopSampleSpeech() {
  if (sampleUtterance) {
    sampleUtterance.onend = null;
    sampleUtterance.onerror = null;
    window.speechSynthesis.cancel();
    sampleUtterance = null;
  }
  readButton.querySelector("span").textContent = "Read answer aloud";
}
function showSampleAnswer(topic = sampleTopic) {
  if (!Object.hasOwn(sampleQuestions, topic)) return;
  stopSampleSpeech();
  sampleTopic = topic;
  const result = answerProjectQuestion(sampleProject, sampleQuestions[topic]);
  const answer = result.answers[0];
  document.querySelector("#voice-demo-question").textContent =
    sampleQuestions[topic];
  document.querySelector("#voice-answer-title").textContent = answer.title;
  document.querySelector("#voice-answer-text").textContent = answer.text;
  document.querySelector("#voice-answer-source").textContent =
    `Source: ${answer.sources.join("; ")}`;
  document
    .querySelectorAll("[data-question]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.question === topic),
      ),
    );
  sampleStatus.textContent = "";
}
document
  .querySelectorAll("[data-question]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      showSampleAnswer(button.dataset.question),
    ),
  );
document.querySelector("#voice-demo-ask").addEventListener("click", () => {
  showSampleAnswer();
  sampleStatus.textContent =
    "Sample answer shown. In the app, tap Ask by voice and speak.";
});
readButton.disabled = !canReadSample;
readButton.addEventListener("click", () => {
  if (!canReadSample) return;
  if (sampleUtterance) {
    stopSampleSpeech();
    return;
  }
  const answer = answerProjectQuestion(
    sampleProject,
    sampleQuestions[sampleTopic],
  ).answers[0];
  const speech = new window.SpeechSynthesisUtterance(
    `${sampleProject.title}. ${answer.text}`,
  );
  speech.lang = "en-US";
  sampleUtterance = speech;
  readButton.querySelector("span").textContent = "Stop reading";
  speech.onend = () => {
    if (sampleUtterance === speech) stopSampleSpeech();
  };
  speech.onerror = () => {
    if (sampleUtterance !== speech) return;
    stopSampleSpeech();
    sampleStatus.textContent =
      "Audio is unavailable here. The sample answer is still shown.";
  };
  try {
    window.speechSynthesis.speak(speech);
  } catch {
    stopSampleSpeech();
    sampleStatus.textContent =
      "Audio is unavailable here. The sample answer is still shown.";
  }
});
window.addEventListener("pagehide", stopSampleSpeech);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSampleSpeech();
});
showSampleAnswer();

// Public checkout remains server-gated; the CTA always reaches the purchase page.
fetch("/api/purchase/config", { cache: "no-store", credentials: "same-origin" })
  .then((r) => (r.ok ? r.json() : null))
  .then((config) => {
    if (!config?.enabled || config.mode !== "live") return;
    if (
      ![config.amount, config.standardAmount].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      config.currency !== "usd" ||
      ![7, 14, 30].includes(config.refundDays)
    )
      return;
    const format = (amount) => currency.format(amount / 100);
    document.querySelector(".standard-price .price").textContent = format(
      config.standardAmount,
    );
    document.querySelector(".launch-price .price").textContent = format(
      config.amount,
    );
    const launch = config.amount < config.standardAmount;
    document.querySelector(".launch-price h3").textContent = launch
      ? "First 200 Only Launch Offer"
      : "One-time purchase";
    document.querySelector(".original-price s").textContent = format(
      config.standardAmount,
    );
    document.querySelector(".original-price").hidden = !launch;
    const saving = document.querySelector(".launch-saving");
    saving.hidden = !launch;
    saving.textContent = `${Math.round((1 - config.amount / config.standardAmount) * 100)}% off · save ${format(config.standardAmount - config.amount)}`;
    purchasePrices = {
      standard: config.standardAmount / 100,
      launch: config.amount / 100,
    };
    document.querySelector("#roi-standard-price").textContent =
      `At ${format(config.standardAmount)}`;
    document.querySelector("#roi-launch-price").textContent =
      `At ${format(config.amount)}${launch ? " launch price" : ""}`;
    document.querySelector("#roi-launch-price").parentElement.hidden = !launch;
    updateValue();
    document.querySelectorAll("[data-refund-days]").forEach((label) => {
      label.textContent = `${config.refundDays}-day money-back guarantee`;
    });
    document.querySelectorAll("[data-refund-period]").forEach((label) => {
      label.textContent = `${config.refundDays} days`;
    });
    document.querySelector("[data-checkout-note]").textContent = launch
      ? "Launch places are reserved when checkout starts. Final price and any taxes are shown before payment."
      : "Pay once. Your final price and any taxes are shown before payment.";
  })
  .catch(() => {
    /* The purchase page rechecks availability and the final quote. */
  });
