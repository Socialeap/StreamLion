// A chat flow is an ordered list of conditional steps. Each answer is
// validated and committed immediately, and the next question is the first
// applicable step that is not yet confirmed. Editing an answer re-asks only
// that step; steps that depend on it are re-asked as well.
//
// Step fields used here: id, stage, when(answers, ctx), validate(value,
// answers, ctx), satisfied(ctx, stored) and action for steps confirmed by a
// live connection, defaultValue(answers, ctx) and dependents (step ids).
export function createFlow(steps, { finalStep = "review" } = {}) {
  const byId = new Map(steps.map((step) => [step.id, step]));

  // Action steps count as done only while the live connection confirms them.
  // A done step whose stored answer no longer validates (for example after an
  // option list changed) is asked again. Stored answers are re-checked without
  // runtime limits such as being offline.
  function walk(state, ctx = {}) {
    const answers = {},
      history = [];
    for (const step of steps) {
      if (step.when && !step.when(answers, ctx)) continue;
      const automatic = step.satisfied?.(ctx, state.answers[step.id]);
      if (automatic !== undefined) {
        answers[step.id] = automatic;
        history.push({ step, value: automatic, automatic: true });
        continue;
      }
      if (state.done.includes(step.id) && !step.action) {
        try {
          const value = step.validate(state.answers[step.id], answers, {});
          answers[step.id] = value;
          history.push({ step, value });
          continue;
        } catch {
          /* ask again below */
        }
      }
      return { answers, history, current: step };
    }
    return { answers, history, current: null };
  }
  function suggestedValue(state, step, answers, ctx = {}) {
    if (Object.hasOwn(state.answers, step.id)) return state.answers[step.id];
    return step.defaultValue?.(answers, ctx);
  }
  function withoutDependents(done, id) {
    const remove = new Set();
    const queue = [...(byId.get(id)?.dependents || [])];
    while (queue.length) {
      const next = queue.shift();
      if (remove.has(next)) continue;
      remove.add(next);
      queue.push(...(byId.get(next)?.dependents || []));
    }
    return done.filter((item) => !remove.has(item));
  }
  function answerStep(state, id, value, ctx = {}, now) {
    const step = byId.get(id);
    const { answers, current } = walk(state, ctx);
    if (!step || current?.id !== id)
      throw new Error("This question changed. Review the current question.");
    const clean = step.validate(value, answers, ctx);
    const changed =
      JSON.stringify(state.answers[id]) !== JSON.stringify(clean) &&
      Object.hasOwn(state.answers, id);
    const done = changed ? withoutDependents(state.done, id) : state.done;
    const time = now || new Date().toISOString();
    return {
      ...state,
      status: id === finalStep ? "complete" : "active",
      answers: { ...state.answers, [id]: clean },
      done: [...done.filter((item) => item !== id), id],
      updatedAt: time,
      ...(id === finalStep ? { completedAt: time } : {}),
    };
  }
  function editStep(state, id, now) {
    return {
      ...state,
      status: "active",
      done: state.done.filter((item) => item !== id && item !== finalStep),
      updatedAt: now || new Date().toISOString(),
    };
  }
  function stageProgress(walked, stages) {
    const stage = walked.current ? walked.current.stage : stages.length;
    return {
      stage: Math.min(stage, stages.length - 1),
      label: walked.current ? stages[walked.current.stage] : "All set",
      percent: walked.current
        ? Math.round((walked.current.stage / stages.length) * 100)
        : 100,
    };
  }
  return {
    steps,
    stepById: (id) => byId.get(id),
    walk,
    suggestedValue,
    answerStep,
    editStep,
    // Reopen a finished flow on its final card so any answer can be revised.
    reopen: (state, now) => editStep(state, finalStep, now),
    stageProgress,
  };
}
