import test from "node:test";
import assert from "node:assert/strict";
import {
  closeoutNextActions,
  checklistFromJobDetails,
} from "./landing-demo.js";
import {
  requirementsFromBrief,
  beforeLeaving,
  scopeSignature,
} from "./workflow.js";

test("the sample checklist uses the real job requirements and identifies specific unfinished work", () => {
  const project = {
    id: "demo",
    scope: "Living room and kitchen",
    deliverables:
      "Capture living room\nCapture kitchen\nCheck kitchen length and width",
  };
  const plan = {
    requirements: requirementsFromBrief(project),
    scopeSignature: scopeSignature(project),
  };
  plan.requirements[0].state = "done";
  assert.deepEqual(
    beforeLeaving(project, plan, []).map((item) => item.label),
    ["Capture kitchen", "Check kitchen length and width"],
  );
  plan.requirements.forEach((item) => {
    item.state = "done";
  });
  assert.deepEqual(beforeLeaving(project, plan, []), []);
  assert.match(
    beforeLeaving({ ...project, scope: "Upstairs too" }, plan, []).at(0).label,
    /changed brief/,
  );
});
test("rooms and requested dimensions become separate actions, with unchanged names", () => {
  const { plan } = checklistFromJobDetails(
    "Ground floor\nKitchen\nKitchen",
    "Kitchen length\nKitchen width",
  );
  assert.deepEqual(
    plan.requirements.slice(0, 4).map((item) => item.label),
    [
      "Capture Ground floor",
      "Capture Kitchen",
      "Check Kitchen length against the tape",
      "Check Kitchen width against the tape",
    ],
  );
  assert.throws(() => checklistFromJobDetails("", ""), /Add an agreed space/);
  assert.throws(
    () =>
      checklistFromJobDetails(
        Array.from({ length: 41 }, (_, i) => `Room ${i}`).join("\n"),
        "",
      ),
    /shorter checklist/,
  );
});
test("received payment does not hide unfinished delivery or requested changes", () => {
  const paid = closeoutNextActions(
    "Not sent",
    "Awaiting confirmation",
    "Received",
  );
  assert.match(paid.headline, /send the agreed handover/);
  assert.match(paid.reason, /still needs/);
  const changes = closeoutNextActions("Sent", "Changes requested", "Received");
  assert.match(changes.headline, /requested changes/);
  assert.notEqual(changes.headline, "Handover complete");
});
test("missing payment data asks for verification rather than asserting an unpaid balance", () => {
  const result = closeoutNextActions("Sent", "Accepted", "Not recorded");
  assert.match(result.headline, /check the payment record/);
  assert.match(result.actions[0].detail, /bank receipt/);
  assert.doesNotMatch(result.headline, /unpaid|overdue/);
  assert.match(
    closeoutNextActions("Sent", "Accepted", "Part received").headline,
    /remaining balance/,
  );
});
test("inconsistent delivery/acceptance records prompt a check before duplicate delivery", () => {
  const result = closeoutNextActions("Not sent", "Accepted", "Received");
  assert.match(result.headline, /check the delivery record/);
  assert.match(result.actions[0].detail, /before sending it again/);
});
test("the sample invoice balance uses explicit amounts and the real money calculation", () => {
  const result = closeoutNextActions("Sent", "Accepted", "Part received", {
    invoiceAmount: "300",
    paidAmount: "150",
    currency: "USD",
  });
  assert.equal(result.outstanding, "$150.00");
  assert.match(
    result.actions[0].detail,
    /\$150\.00 remains on the \$300\.00 invoice/,
  );
  const unknown = closeoutNextActions("Sent", "Accepted", "Not recorded", {
    invoiceAmount: "300",
    paidAmount: "",
    currency: "USD",
  });
  assert.equal(unknown.outstanding, "Not enough information");
});
test("complete handover is distinct from all other sample states", () => {
  for (const delivery of ["Not sent", "Sent"])
    for (const acceptance of [
      "Awaiting confirmation",
      "Accepted",
      "Changes requested",
    ])
      for (const payment of ["Not recorded", "Part received", "Received"]) {
        const result = closeoutNextActions(delivery, acceptance, payment);
        assert.equal(
          result.actions.length === 0,
          delivery === "Sent" &&
            acceptance === "Accepted" &&
            payment === "Received",
        );
      }
  assert.equal(closeoutNextActions("invalid", "Accepted", "Received"), null);
});
