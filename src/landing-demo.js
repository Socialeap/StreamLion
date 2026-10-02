import {
  requirementsFromBrief,
  scopeSignature,
  paymentSummary,
} from "./workflow.js";

/** Generate specific actions from explicit rooms/readings, without inferring unnamed spaces. */
export function checklistFromJobDetails(spaces, readings) {
  const lines = (text) => [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  const rooms = lines(spaces),
    dimensions = lines(readings);
  if (!rooms.length && !dimensions.length)
    throw new Error(
      "Add an agreed space or required measurement, then build the checklist.",
    );
  const project = {
    id: "demo-checklist",
    scope: JSON.stringify({ rooms, dimensions }),
    deliverables: [
      ...rooms.map((room) => `Capture ${room}`),
      ...dimensions.map((reading) => `Check ${reading} against the tape`),
      "Record front-entrance access conditions",
    ].join("\n"),
  };
  return {
    project,
    spaces: rooms,
    readings: dimensions,
    plan: {
      requirements: requirementsFromBrief(project),
      scopeSignature: scopeSignature(project),
    },
  };
}

/** A sample closeout turns recorded states into a sequenced follow-up plan. */
export function closeoutNextActions(
  delivery,
  acceptance,
  payment,
  amounts = {},
) {
  if (
    !["Not sent", "Sent"].includes(delivery) ||
    !["Awaiting confirmation", "Accepted", "Changes requested"].includes(
      acceptance,
    ) ||
    !["Not recorded", "Part received", "Received"].includes(payment)
  )
    return null;
  const totals = paymentSummary(amounts);
  const actions = [];
  if (delivery === "Not sent") {
    actions.push(
      acceptance === "Accepted"
        ? {
            label: "Check the delivery record",
            detail:
              "Client acceptance is recorded, but delivery is marked not sent. Confirm what was delivered before sending it again.",
          }
        : {
            label: "Send the agreed handover",
            detail:
              "Gather the tour link, site notes and checked room readings for the commissioning company.",
          },
    );
  }
  if (acceptance === "Changes requested")
    actions.push({
      label: "Agree the requested changes",
      detail:
        "Confirm which items need attention and when you will return them. Keep the request with the job.",
    });
  else if (acceptance === "Awaiting confirmation" && delivery === "Sent")
    actions.push({
      label: "Request client acceptance",
      detail:
        "Ask the client to confirm the delivered work meets the agreed brief, or identify specific changes.",
    });
  if (payment === "Not recorded")
    actions.push({
      label: "Check the payment record",
      detail:
        "Compare your invoice and bank receipt. Record what was received and the due date before deciding whether a payment follow-up is needed.",
    });
  else if (payment === "Part received")
    actions.push({
      label: "Confirm the remaining balance",
      detail:
        totals.outstanding === "Not enough information"
          ? "Compare the invoiced amount with the amount received, then follow up on the balance according to the agreed payment terms."
          : `${totals.outstanding} remains on the ${totals.invoiced} invoice. Check the agreed due date before following up on the balance.`,
    });
  return {
    outstanding: totals.outstanding,
    headline: actions.length
      ? `Next: ${actions[0].label.toLowerCase()}`
      : "Handover complete",
    actions,
    reason: !actions.length
      ? "Delivery, client acceptance and payment are all recorded. Keep the handover and receipt with the project for the next visit."
      : payment === "Received"
        ? "Payment is recorded as received. The job still needs the delivery or acceptance actions above."
        : delivery === "Sent" && acceptance === "Accepted"
          ? "The client has accepted the work. Focus your follow-up on the payment record."
          : "Delivery, acceptance and payment each answer a different question. Work through these actions in order.",
  };
}
