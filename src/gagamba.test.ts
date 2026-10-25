import { weaveSignals } from "./gagamba.js";
import type { GagambaSignal } from "./gagamba.js";
import { decide } from "./orchestrator.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${message}: expected ${expectedJson}, got ${actualJson}`);
}

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

  assertDeepEqual(woven.observation.facts, ["Customer asked for a reversible sandbox preview."], "facts");
  assertDeepEqual(woven.observation.unknowns, ["Production credentials are not connected."], "unknowns");
  assertDeepEqual(woven.observation.resources, ["Local policy lab"], "resources");
  assertDeepEqual(woven.observation.constraints, ["No external mutation"], "constraints");
  assert(woven.trace.withheldSignalIds.length === 0, "expected no withheld signals");
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

  assert(woven.observation.facts.length === 0, "inference/prediction must not become facts");
  assertDeepEqual(woven.observation.inferences, ["This route is probably safe."], "inferences");
  assertDeepEqual(woven.observation.predictions, ["The adapter will succeed."], "predictions");
  assert(
    woven.observation.unknowns.every((item) => item.includes("requires_validation")),
    "inference/prediction should remain validation gaps",
  );
  assertDeepEqual(
    woven.observation.constraints,
    ["human_preference: Prefer the smallest reversible action."],
    "preference constraint",
  );

  const decision = decide(woven.observation, {
    autonomyLevel: 3,
    riskTolerance: 0.5,
    confidenceThreshold: 0.7,
  });
  assert(decision.gate === "ASK_USER", `expected ASK_USER, got ${decision.gate}`);
  assert(decision.reasons.includes("important_unknowns_present"), "expected unknowns gate");
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

  assertDeepEqual(woven.trace.acceptedSignalIds, ["dup", "same-1"], "accepted signal ids");
  assertDeepEqual(
    woven.trace.withheldSignalIds,
    ["dup", "same-2", "bad-confidence"],
    "withheld signal ids",
  );
  assert(woven.trace.reasons.includes("duplicate_signal_id"), "expected duplicate id reason");
  assert(
    woven.trace.reasons.includes("duplicate_signal_content"),
    "expected duplicate content reason",
  );
  assert(
    woven.trace.reasons.includes("invalid_signal_confidence"),
    "expected invalid confidence reason",
  );
}

{
  const invalidKind = {
    id: "bad-kind",
    kind: "ASSERTED_TRUTH",
    text: "A runtime caller must not invent a new epistemic class.",
  } as unknown as GagambaSignal;

  const woven = weaveSignals({ signals: [invalidKind], candidates: [] });

  assertDeepEqual(woven.trace.acceptedSignalIds, [], "invalid kind must not be accepted");
  assertDeepEqual(woven.trace.withheldSignalIds, ["bad-kind"], "invalid kind withheld id");
  assert(woven.trace.reasons.includes("invalid_signal_kind"), "expected invalid signal kind reason");
  assert(woven.observation.facts.length === 0, "invalid kind must not leak into facts");
}

console.log("gagamba tests passed");
