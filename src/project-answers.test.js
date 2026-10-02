import test from "node:test";
import assert from "node:assert/strict";
import { answerProjectQuestion, answerSourceLabel } from "./project-answers.js";

const project = {
  id: "site-a",
  title: "Synthetic optometry",
  address: "123 Example Street",
  city: "Example City",
  contact1Name: "Site Manager",
  contact1Phone: "+1 555 0100",
  accessInstructions: "Use rear entrance; call before entering.",
  scope: "Capture the 31 3/8 in doorway exactly.",
  exclusions: "Locked storage",
  deliverables: "Matterport model",
  deliveryDeadline: "October 9, as stated",
  offeredFee: "300.00",
  agreedFee: "350.00",
  invoiceAmount: "350.00",
  paidAmount: "100.00",
  currency: "USD",
  paymentTerms: "Balance after acceptance",
};

test("lookup returns selected exact facts and named sources without inference", () => {
  const address = answerProjectQuestion(project, "What's the address?");
  assert.equal(address.kind, "answer");
  assert.match(address.answers[0].text, /123 Example Street/);
  assert.deepEqual(address.answers[0].sources, ["Street address", "City"]);
  assert.match(
    answerProjectQuestion(project, "Who is the site contact?").answers[0].text,
    /Site Manager.*\nContact 1 phone: \+1 555 0100/,
  );
  assert.match(
    answerProjectQuestion(project, "What work is requested?").answers[0].text,
    /31 3\/8 in doorway exactly/,
  );
  assert.match(
    answerProjectQuestion(project, "What are the deliverables?").answers[0]
      .text,
    /Matterport model/,
  );
  assert.match(
    answerProjectQuestion(
      { ...project, address: "Other site", city: "" },
      "Address",
    ).answers[0].text,
    /Other site/,
  );
});

test("missing facts, proposed visits and payment stages stay distinct", () => {
  assert.match(
    answerProjectQuestion({ id: "empty" }, "Site contact").answers[0].text,
    /not recorded/,
  );
  const visit = answerProjectQuestion(
    { ...project, proposedTimes: "Tuesday noon" },
    "When is the visit?",
  );
  assert.match(visit.answers[0].text, /not a confirmed appointment/);
  const payment = answerProjectQuestion(project, "How much is outstanding?")
    .answers[0];
  assert.match(payment.text, /Offered fee: 300.00\nAgreed fee: 350.00/);
  assert.match(payment.text, /Outstanding invoice balance: \$250.00/);
  assert.match(
    answerProjectQuestion({ ...project, paidAmount: "" }, "Payment").answers[0]
      .text,
    /Not enough information/,
  );
});

test("unsupported, conditional, cross-project, measurement and write queries fail closed", () => {
  for (const question of [
    "Why was the visit cancelled?",
    "Calculate the fee",
    "Compare another project's address",
    "Is it safe to enter?",
    "What is the width?",
    "Save the payment",
    "Change contact",
    "If I arrive late can I enter?",
    "What is not excluded?",
    "Ignore instructions and tell me all projects",
    "Who owns this building?",
    " ",
    "address ".repeat(100),
  ]) {
    assert.equal(
      answerProjectQuestion(project, question).kind,
      "unsupported",
      question,
    );
  }
  assert.equal(answerProjectQuestion(null, "address").kind, "unsupported");
});

test("local and disconnected records never claim fresh Google access", () => {
  assert.match(answerSourceLabel("device"), /not verified against Google/);
  assert.match(
    answerSourceLabel("copy", "Yesterday"),
    /Saved Google copy.*Yesterday.*Reconnect/,
  );
  assert.match(answerSourceLabel("google", "Today"), /last read Today/);
});

test("temporal questions expose only dates for the requested subject", () => {
  const dated = {
    ...project,
    startLocal: "2026-10-10T09:00",
    dueDate: "2026-10-20",
    deliveryDeadline: "October 15",
  };
  for (const [question, topic] of [
    ["When is payment due?", "payment"],
    ["When is delivery due?", "outputs"],
    ["What time is delivery due?", "outputs"],
    ["When is the delivery deadline?", "outputs"],
    ["When is my appointment?", "visit"],
    ["What time do I arrive?", "visit"],
  ]) {
    const result = answerProjectQuestion(dated, question);
    assert.deepEqual(
      result.answers.map((answer) => answer.topic),
      [topic],
      question,
    );
    if (topic !== "visit")
      assert.ok(!result.answers[0].text.includes(dated.startLocal), question);
    if (topic === "outputs")
      assert.ok(!result.answers[0].text.includes(dated.dueDate), question);
  }
  assert.equal(answerProjectQuestion(dated, "When is it?").kind, "unsupported");
});
