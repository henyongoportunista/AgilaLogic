import { decide } from "./orchestrator.js";
import type { AgentPolicy, ObservationInput } from "./types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const draftPolicy: AgentPolicy = {
  autonomyLevel: 2,
  riskTolerance: 0.25,
  confidenceThreshold: 0.65,
};

const baseInput: ObservationInput = {
  facts: ["A bounded action is available."],
  unknowns: [],
  constraints: [],
  resources: ["approval gate"],
  candidates: [
    {
      id: "bounded-action",
      value: 0.9,
      timing: 0.9,
      confidence: 0.9,
      cost: 0.1,
      risk: 0.1,
      reversibility: 0.9,
      informationGain: 0.7,
    },
  ],
};

{
  const result = decide(baseInput, draftPolicy);
  assert(result.gate === "DRAFT", `expected DRAFT, got ${result.gate}`);
  assert(result.selected?.id === "bounded-action", "expected bounded-action selection");
}

{
  const result = decide(
    {
      ...baseInput,
      candidates: [{ ...baseInput.candidates[0], risk: 0.9 }],
    },
    { ...draftPolicy, autonomyLevel: 5 },
  );
  assert(result.gate === "REJECT", `expected REJECT, got ${result.gate}`);
  assert(result.reasons.includes("risk_too_high"), "expected risk_too_high reason");
}

{
  const result = decide(
    {
      ...baseInput,
      candidates: [
        {
          id: "noise",
          value: 0.1,
          timing: 0.5,
          confidence: 0.5,
          cost: 0.5,
          risk: 0.5,
          reversibility: 0.5,
          informationGain: 0.1,
        },
      ],
    },
    draftPolicy,
  );
  assert(result.gate === "OBSERVE_ONLY", `expected OBSERVE_ONLY, got ${result.gate}`);
}

{
  const result = decide(
    {
      ...baseInput,
      unknowns: ["counterparty intent"],
    },
    { ...draftPolicy, autonomyLevel: 4 },
  );
  assert(result.gate === "ASK_USER", `expected ASK_USER, got ${result.gate}`);
  assert(
    result.reasons.includes("important_unknowns_present"),
    "expected important_unknowns_present reason",
  );
}

console.log("orchestrator tests passed");
