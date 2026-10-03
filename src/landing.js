import "./landing.css";
import { READINGS } from "./brief-tasks.js";
import { parseMeasurements } from "./measurements.js";
import {
  confirmedPurchaseQuote,
  estimateTaskValue,
  VALUE_TASKS,
} from "./landing-value.js";
import { answerProjectQuestion } from "./project-answers.js";
import { beforeLeaving } from "./workflow.js";
import { closeoutNextActions } from "./landing-demo.js";
import {
  sampleJob,
  sampleSuggestions,
  applySampleBrief,
  sampleReading,
  sampleLockedRoom,
} from "./landing-job.js";

const descriptions = {
  prepare: {
    benefit: "Turn client wording into reviewed site tasks.",
    description:
      "Review each suggested task beside its source. Edit what needs changing, then carry the tasks into the visit.",
    area: "Job brief",
  },
  site: {
    benefit: "Catch the missing reading before you pack up.",
    description:
      "Keep tape-checked readings with the right room. Try a locked room to see how exceptions become next actions.",
    area: "Room readings",
  },
  handover: {
    benefit: "Show your client the work and what needs attention.",
    description:
      "Preview your provider-branded handover. The same tasks, readings and exceptions flow into one report.",
    area: "Client handover",
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
let purchasePrices = { standard: 39.95, launch: 39.95 };
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

let demoJob = sampleJob();
let briefDraft;
let organizedReading;
let reportModule;
let reportPromise;
const reportImages = {};
const brief = document.querySelector("#demo-brief");
const briefReviewed = document.querySelector("#brief-reviewed");
const tapeReviewed = document.querySelector("#tape-reviewed");
const keepReadings = document.querySelector("#keep-readings");
function showBriefSuggestions() {
  try {
    briefDraft = sampleSuggestions(demoJob.project, brief.value);
    briefReviewed.checked = false;
    const holder = document.querySelector("#task-suggestions");
    holder.replaceChildren();
    for (const item of briefDraft.suggestions) {
      const card = document.createElement("div");
      card.className = "suggested-task";
      const label = document.createElement("label"),
        chosen = document.createElement("input"),
        title = document.createElement("span");
      chosen.type = "checkbox";
      chosen.checked = item.selected;
      chosen.setAttribute("aria-label", `Include ${item.label}`);
      title.textContent = item.label;
      const quote = document.createElement("blockquote");
      quote.textContent = item.source.quote;
      const edit = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = "Edit this task";
      edit.append(summary);
      const wordingLabel = document.createElement("label"),
        wording = document.createElement("input");
      wordingLabel.textContent = "Task wording";
      wording.value = item.label;
      wording.maxLength = 500;
      wording.setAttribute("aria-label", `Task wording: ${item.label}`);
      wordingLabel.append(wording);
      edit.append(wordingLabel);
      const resetReview = () => {
        briefReviewed.checked = false;
      };
      chosen.addEventListener("change", () => {
        item.selected = chosen.checked;
        resetReview();
      });
      wording.addEventListener("input", () => {
        item.label = wording.value;
        title.textContent = item.label;
        resetReview();
      });
      label.append(chosen, title);
      card.append(label, quote);
      if (["capture", "measurement"].includes(item.kind)) {
        const areaLabel = document.createElement("label"),
          area = document.createElement("input");
        areaLabel.textContent = "Required space";
        area.value = item.area;
        area.maxLength = 100;
        area.addEventListener("input", () => {
          item.area = area.value;
          item.label =
            item.kind === "measurement"
              ? `Check ${item.area} ${item.reading.toLowerCase()} against the tape`
              : `Capture ${item.area}`;
          wording.value = item.label;
          title.textContent = item.label;
          resetReview();
        });
        areaLabel.append(area);
        edit.append(areaLabel);
      }
      if (item.kind === "measurement") {
        const readingLabel = document.createElement("label"),
          reading = document.createElement("select");
        readingLabel.textContent = "Required reading";
        for (const name of READINGS) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          option.selected = name === item.reading;
          reading.append(option);
        }
        reading.addEventListener("change", () => {
          item.reading = reading.value;
          item.label = `Check ${item.area} ${item.reading.toLowerCase()} against the tape`;
          wording.value = item.label;
          title.textContent = item.label;
          resetReview();
        });
        readingLabel.append(reading);
        edit.append(readingLabel);
      }
      card.append(edit);
      holder.append(card);
    }
    document.querySelector("#brief-status").textContent =
      "Suggested tasks are ready to review. Delivery stays separate from site checks.";
  } catch (error) {
    briefDraft = undefined;
    document.querySelector("#brief-status").textContent = error.message;
  }
}
function updateChecklist() {
  const focusedTask = document.activeElement?.dataset.taskId;
  const holder = document.querySelector("#checklist-items");
  holder.replaceChildren();
  for (const item of demoJob.plan.requirements.filter(
    (item) => item.kind !== "delivery",
  )) {
    const label = document.createElement("label"),
      input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.taskId = item.id;
    input.checked = item.state === "done";
    input.disabled = item.state === "blocked";
    input.addEventListener("change", () => {
      item.state = input.checked ? "done" : "todo";
      updateChecklist();
    });
    label.append(
      input,
      document.createTextNode(
        `${item.label}${item.state === "blocked" ? " · access blocked" : ""}`,
      ),
    );
    holder.append(label);
  }
  if (focusedTask)
    [...holder.querySelectorAll("input")]
      .find((input) => input.dataset.taskId === focusedTask)
      ?.focus({ preventScroll: true });
  const remaining = beforeLeaving(demoJob.project, demoJob.plan, demoJob.notes);
  const list = document.querySelector("#checklist-remaining");
  list.replaceChildren();
  document.querySelector(".demo-status").textContent = !demoJob.plan
    .requirements.length
    ? "Review and add the brief tasks in Prepare to see the site checks."
    : remaining.length
      ? `${remaining.length} ${remaining.length === 1 ? "item needs" : "items need"} attention before leaving job-site:`
      : "Site checks accounted for. Your reviewed readings are ready for the handover.";
  remaining.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.label} — ${item.detail}`;
    list.append(li);
  });
  updateReportSummary();
}
function updateReportSummary() {
  const checked = demoJob.notes.filter((note) => note.reviewed).length;
  const issues = beforeLeaving(
    demoJob.project,
    demoJob.plan,
    demoJob.notes,
  ).length;
  document.querySelector("#report-summary").textContent =
    `${demoJob.plan.requirements.length} brief-linked tasks · ${checked} reviewed field ${checked === 1 ? "record" : "records"} · ${issues} site ${issues === 1 ? "item" : "items"} still needing attention. The report keeps outstanding work visible.`;
}
document
  .querySelector("#build-checklist")
  .addEventListener("click", showBriefSuggestions);
brief.addEventListener("input", () => {
  briefDraft = undefined;
  briefReviewed.checked = false;
  document.querySelector("#task-suggestions").replaceChildren();
  document.querySelector("#brief-status").textContent =
    "Brief changed. Suggest tasks again before reviewing.";
});
document.querySelector("#use-tasks").addEventListener("click", () => {
  try {
    if (!briefDraft)
      throw new Error("Suggest tasks from the current brief first.");
    demoJob = applySampleBrief(demoJob, {
      ...briefDraft,
      reviewed: briefReviewed.checked,
    });
    document.querySelector("#brief-status").textContent =
      "Reviewed tasks added. Room readings already recorded in this sample are kept.";
    document.querySelector("#exception-status").textContent = "";
    document.querySelector("#locked-room").disabled = false;
    updateChecklist();
    chooseStep("site");
  } catch (error) {
    document.querySelector("#brief-status").textContent = error.message;
  }
});
showBriefSuggestions();
// A pre-reviewed sample makes every stage explorable; edits require a fresh review.
demoJob = applySampleBrief(demoJob, { ...briefDraft, reviewed: true });
updateChecklist();

const dictation = document.querySelector("#dictation");
const space = document.querySelector("#measurement-space");
function clearReadingReview() {
  organizedReading = undefined;
  tapeReviewed.checked = false;
  tapeReviewed.disabled = true;
  keepReadings.disabled = true;
}
function organize() {
  const body = document.querySelector("#readings"),
    issues = document.querySelector("#reading-issues");
  body.replaceChildren();
  issues.replaceChildren();
  clearReadingReview();
  try {
    const result = parseMeasurements(dictation.value);
    if (!space.value.trim())
      throw new Error(
        "Name the room or space so the readings stay with the right area.",
      );
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
    if (result.issues.length) {
      issues.textContent = result.issues
        .map((issue) => `Check this wording: ${issue.message}`)
        .join(" ");
      return;
    }
    organizedReading = sampleReading(
      demoJob.project.id,
      space.value,
      dictation.value,
    );
    tapeReviewed.disabled = false;
    issues.textContent =
      "Organized. Check the exact values against your tape, then keep the readings.";
  } catch (error) {
    issues.textContent = error.message;
  }
}
document.querySelector("#organize").addEventListener("click", organize);
tapeReviewed.addEventListener("change", () => {
  keepReadings.disabled = !tapeReviewed.checked || !organizedReading;
});
keepReadings.addEventListener("click", () => {
  if (!organizedReading || !tapeReviewed.checked) return;
  // Replace only this room's sample batch; other-room evidence stays intact.
  demoJob.notes = demoJob.notes.filter(
    (note) => note.area !== organizedReading.area,
  );
  demoJob.notes.push({ ...organizedReading, reviewed: true });
  keepReadings.disabled = true;
  document.querySelector("#reading-issues").textContent =
    "Checked readings kept with this room. Mark the matching site tasks complete when the work is done.";
  updateChecklist();
});
[dictation, space].forEach((input) =>
  input.addEventListener("input", () => {
    clearReadingReview();
    document.querySelector("#readings").replaceChildren();
    document.querySelector("#reading-issues").textContent =
      "Input changed. Organize again before checking the readings.";
  }),
);
organize();
document.querySelector("#locked-room").addEventListener("click", () => {
  try {
    const task = demoJob.plan.requirements.find(
      (item) => item.kind === "capture" && item.state !== "blocked",
    );
    demoJob = sampleLockedRoom(demoJob, task?.id);
    document.querySelector("#exception-status").textContent =
      `${task.area}: access blocked. Next: ask the site contact for access. The exception is linked to this task and appears in the handover.`;
    document.querySelector("#locked-room").disabled =
      !demoJob.plan.requirements.some(
        (item) => item.kind === "capture" && item.state !== "blocked",
      );
    updateChecklist();
  } catch (error) {
    document.querySelector("#exception-status").textContent = error.message;
  }
});

const closeout = ["delivery", "acceptance", "payment"].map((id) =>
  document.getElementById(id),
);
function updateCloseout() {
  demoJob.project.paidAmount =
    closeout[2].selectedOptions[0].dataset.amount || "";
  // Contradictory delivery/acceptance choices remain visible in follow-up guidance.
  demoJob.plan.delivery =
    closeout[0].value === "Not sent"
      ? "not-sent"
      : closeout[1].value === "Accepted"
        ? "accepted"
        : "sent";
  demoJob.plan.deliveredAt =
    demoJob.plan.delivery !== "not-sent" ? new Date().toISOString() : "";
  demoJob.plan.acceptedAt =
    demoJob.plan.delivery === "accepted" ? new Date().toISOString() : "";
  const result = closeoutNextActions(
    ...closeout.map((select) => select.value),
    demoJob.project,
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
const reportDialog = document.querySelector("#report-dialog");
const reportFrame = document.querySelector("#report-frame");
let reportReturnFocus;
reportDialog.addEventListener("close", () => reportReturnFocus?.focus());
const reportButtons = ["preview-report", "print-report"].map((id) =>
  document.getElementById(id),
);
async function prepareReport() {
  reportModule ||= await (reportPromise ||= import("./handover.js").catch(
    (error) => {
      reportPromise = undefined;
      throw error;
    },
  ));
  demoJob.project.providerName = document
    .querySelector("#provider-name")
    .value.trim();
  const model = reportModule.handoverModel(
    demoJob.project,
    demoJob.plan,
    demoJob.notes,
    {
      origin: "Browser-only sample",
      includeUnreviewed: document.querySelector("#report-unchecked").checked,
      includePayment: document.querySelector("#report-payment").checked,
    },
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reportFrame.onload = null;
      reject(new Error("Preview timed out"));
    }, 10000);
    reportFrame.onload = () => {
      // Ignore the iframe's initial about:blank load; wait for the actual report.
      if (!reportFrame.contentDocument?.querySelector(".handover-report"))
        return;
      clearTimeout(timeout);
      reportFrame.onload = null;
      resolve();
    };
    reportFrame.srcdoc = reportModule.handoverDocument(model, reportImages);
  });
}
async function openReport(print) {
  reportReturnFocus = document.activeElement;
  reportButtons.forEach((button) => {
    button.disabled = true;
  });
  try {
    await prepareReport();
    reportDialog.showModal();
    if (print) reportFrame.contentWindow.print();
  } catch {
    document.querySelector("#report-summary").textContent =
      "The preview could not load. Your sample is kept; try again.";
  } finally {
    reportButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}
reportButtons[0].addEventListener("click", () => openReport(false));
reportButtons[1].addEventListener("click", () => openReport(true));
document
  .querySelector("#close-report")
  .addEventListener("click", () => reportDialog.close());
let photoBusy = false;
document
  .querySelector("#demo-photo")
  .addEventListener("change", async (event) => {
    if (photoBusy) return;
    const file = event.target.files[0],
      status = document.querySelector("#photo-status");
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      status.textContent = "Choose a JPEG, PNG or WebP photo up to 5 MB.";
      return;
    }
    photoBusy = true;
    event.target.disabled = true;
    reportButtons.forEach((button) => {
      button.disabled = true;
    });
    let image;
    try {
      image = await createImageBitmap(file);
      const scale = Math.min(1, 900 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const prior = demoJob.notes.find((note) => note.id === "sample-photo");
      if (!prior)
        demoJob.notes.push({
          id: "sample-photo",
          jobId: demoJob.project.id,
          area: "Visitor-added sample photo",
          text: "Photo selected for this sample handover.",
          reviewed: true,
          createdAt: new Date().toISOString(),
        });
      reportImages["sample-photo"] = canvas.toDataURL("image/jpeg", 0.75);
      status.textContent =
        "Photo ready for the preview. It stays in this browser sample and is not uploaded.";
      updateReportSummary();
    } catch {
      status.textContent = "This image could not be opened. Try another photo.";
    } finally {
      image?.close();
      photoBusy = false;
      event.target.disabled = false;
      reportButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  });

// Synthetic preview uses the same bounded lookup as the actual workspace.
// It never opens a microphone or connects to a visitor's Google account.
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
  const result = answerProjectQuestion(demoJob.project, sampleQuestions[topic]);
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
    demoJob.project,
    sampleQuestions[sampleTopic],
  ).answers[0];
  const speech = new window.SpeechSynthesisUtterance(
    `${demoJob.project.title}. ${answer.text}`,
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
  .then(confirmedPurchaseQuote)
  .then((config) => {
    if (!config) return;
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
    /* Keep the standard-price HTML fallback; never imply unconfirmed slots. */
  });
