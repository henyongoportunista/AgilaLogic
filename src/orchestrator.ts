import { hoRank, iwAdapt, kmSelect, mbGate, mtFilter, umFindGaps, uoInventory } from "./modules.js";
import type { AgentPolicy, DecisionResult, ObservationInput } from "./types.js";

export function decide(input: ObservationInput, policy: AgentPolicy): DecisionResult {
  const filtered = mtFilter(input.candidates);
  const gaps = umFindGaps(input);
  const resources = uoInventory(input);
  const adapted = filtered.map(iwAdapt);
  const ranked = hoRank(adapted);
  const selected = kmSelect(ranked);
  const finalGate = mbGate(selected, gaps, policy);

  return {
    gate: finalGate.gate,
    selected,
    reasons: finalGate.reasons,
    gaps,
    resources,
  };
}
