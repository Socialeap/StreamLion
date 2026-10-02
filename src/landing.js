import "./landing.css";
import { parseMeasurements } from "./measurements.js";
import { estimateTimeValue } from "./landing-value.js";
import { answerProjectQuestion } from "./project-answers.js";

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
let purchasePrices;
function updateValue() {
  const estimate = estimateTimeValue(minutes.value, rate.value, purchasePrices);
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
document.querySelectorAll("[data-interest]").forEach((button) =>
  button.addEventListener("click", () => {
    if (button.dataset.purchaseEnabled === "true")
      window.location.assign("/api/purchase");
    else dialog.showModal();
  }),
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

// Keep the existing launch-interest path until the owner enables verified checkout.
fetch("/api/purchase/config", { cache: "no-store", credentials: "same-origin" })
  .then((r) => (r.ok ? r.json() : null))
  .then((config) => {
    if (!config?.enabled || config.mode !== "live") return;
    document.querySelectorAll("[data-interest]").forEach((button) => {
      button.dataset.purchaseEnabled = "true";
      button.textContent = "Buy StreamLion";
    });
    const format = (amount) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount / 100);
    document.querySelector(".standard-price .price").textContent = format(
      config.standardAmount,
    );
    document.querySelector(".launch-price .price").textContent = format(
      config.amount,
    );
    const launch = config.amount < config.standardAmount;
    document.querySelector(".launch-price h3").textContent = launch
      ? "First 100 purchases"
      : "One-time purchase";
    document.querySelector(".original-price s").textContent = format(
      config.standardAmount,
    );
    document.querySelector(".original-price").hidden = !launch;
    const saving = document.querySelector(".launch-saving");
    saving.hidden = !launch;
    saving.textContent = `Launch offer · save ${format(config.standardAmount - config.amount)}`;
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
    const faq = document.querySelector("[data-launch-faq]");
    if (faq)
      faq.textContent = launch
        ? "Sales are open. Launch-priced places are confirmed at checkout. The first 100 completed purchases receive the launch price; an email request does not reserve a place."
        : "Sales are open at the one-time price shown above.";
    const note = document.querySelector("[data-checkout-note]");
    if (note)
      note.textContent =
        "Pay once. Your final price and any taxes are shown before payment.";
  })
  .catch(() => {
    /* launch-interest path remains usable */
  });
