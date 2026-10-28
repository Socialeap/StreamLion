const phaseDetails = [
  "33 min saved · 45 → 12 min. Turn the client brief into reviewed tasks and agree access details before the visit.",
  "35 min saved · 120 → 85 min. Keep the agreed scope, progress and client clarification beside the fieldwork.",
  "45 min saved · 60 → 15 min. Review a Completion Brief built around the scope, evidence and logged exceptions.",
  "40 min saved · 45 → 5 min. A modeled allowance for avoidable follow-up and return visits; rework can still occur.",
];

export function initializeEfficiency(root) {
  const buttons = [...root.querySelectorAll("[data-efficiency-phase]")];
  const detail = root.querySelector("#efficiency-detail");
  if (!detail) return;
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((other) =>
        other.setAttribute("aria-pressed", String(other === button)),
      );
      detail.textContent = phaseDetails[Number(button.dataset.efficiencyPhase)];
    });
  });
}
