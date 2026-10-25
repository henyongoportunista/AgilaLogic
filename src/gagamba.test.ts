import assert from "node:assert/strict";
import { weaveSignals } from "./gagamba.js";
import { decide } from "./orchestrator.js";

const candidate = {
  id: "candidate-a",
  value: 0.8,
  timing: 0.8,
  confidence: 0.9,
  cost: 0.1,
  risk: 0.2,
  reversibility: 0.9,
  informationGain: 0.7,
};

{
  const woven = weaveSignals({
    signals: [
      { id: "f1", kind: "FACT", text: "  Customer asked for a reversible sandbox preview.  " },
      { id: "u1", kind: "UNKNOWN", text: "Production credentials are not connected." },
      { id: "r1", kind: "RESOURCE", text: "Local policy lab" },
      { id: "c1", kind: "CONSTRAINT", text: "No external mutation" },
    ],
    candidates: [candidate],
  });

  assert.deepEqual(woven.observation.facts, ["Customer asked for a reversible sandbox preview."]);
  assert.deepEqual(woven.observation.unknowns, ["Production credentials are not connected."]);
  assert.deepEqual(woven.observation.resources, ["Local policy lab"]);
  assert.deepEqual(woven.observation.constraints, ["No external mutation"]);
  assert.equal(woven.trace.withheldSignalIds.length, 0);
}

{
  const woven = weaveSignals({
    signals: [
      { id: "i1", kind: "INFERENCE", text: "This route is probably safe." },
      { id: "p1", kind: "PREDICTION", text: "The adapter will succeed." },
      { id: "pref1", kind: "PREFERENCE", text: "Prefer the smallest reversible action." },
    ],
    candidates: [candidate],
  });

  assert.equal(woven.observation.facts.length, 0);
  assert.deepEqual(woven.observation.inferences, ["This route is probably safe."]);
  assert.deepEqual(woven.observation.predictions, ["The adapter will succeed."]);
  assert.ok(woven.observation.unknowns.every((item) => item.includes("requires_validation")));
  assert.deepEqual(woven.observation.constraints, ["human_preference: Prefer the smallest reversible action."]);

  const decision = decide(woven.observation, {
    autonomyLevel: 3,
    riskTolerance: 0.5,
    confidenceThreshold: 0.7,
  });
  assert.equal(decision.gate, "ASK_USER");
  assert.ok(decision.reasons.includes("important_unknowns_present"));
}

{
  const woven = weaveSignals({
    signals: [
      { id: "dup", kind: "FACT", text: "one" },
      { id: "dup", kind: "FACT", text: "two" },
      { id: "same-1", kind: "RESOURCE", text: "Notebook" },
      { id: "same-2", kind: "RESOURCE", text: " notebook " },
      { id: "bad-confidence", kind: "FACT", text: "bad", confidence: 2 },
    ],
    candidates: [candidate],
  });

  assert.deepEqual(woven.trace.acceptedSignalIds, ["dup", "same-1"]);
  assert.deepEqual(woven.trace.withheldSignalIds, ["dup", "same-2", "bad-confidence"]);
  assert.ok(woven.trace.reasons.includes("duplicate_signal_id"));
  assert.ok(woven.trace.reasons.includes("duplicate_signal_content"));
  assert.ok(woven.trace.reasons.includes("invalid_signal_confidence"));
}

console.log("gagamba tests passed");
